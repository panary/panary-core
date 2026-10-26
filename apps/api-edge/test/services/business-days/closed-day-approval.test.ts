// Ruhetag-Gate gegen die migrierte SQLite und die echte Hook-Kette
// (panary/panary-core#1133, ADR 0062).
//
// Die Filiale ist an JEDEM Wochentag geschlossen, damit „heute" unabhängig vom
// Testdatum Ruhetag ist. Kein CONNECTED-Pairing (geteilte Test-SQLite, siehe
// close-day-outbox-guard.test.ts) — es ist also der Standalone-Pfad, in dem die
// Freigabe den Tag selbst eröffnet.
//
// Jeder Test legt seine eigene Filiale an (testing.md §10): Die Fälle ändern Tag
// und Regel und liefen unter `--sequence.shuffle` sonst gegen fremden Zustand.
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import { generateDefaultLocationSettings, locationCalendarDate } from '@panary/locations/domain'
import { AppError } from '@panary/shared-common'

import { app } from '../../../src/app'
import { restrictOrderToBusinessDay } from '../../../src/hooks/restrict-order-to-business-day'

interface BusinessDayRow {
  _id: string
  status: string
  date: string
  openedOnClosedDayBy?: string | null
  openedOnClosedDayRole?: string | null
  openedOnClosedDayDate?: string | null
}

describe('businessdays.approveClosedDay — Ruhetag-Gate end-to-end', () => {
  const internal = { provider: undefined } as const
  const PIN = '2580'
  const settings = {
    ...generateDefaultLocationSettings,
    openingHoursSettings: {
      enabled: true,
      regular: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open: '10:00', close: '22:00', closed: true })),
    },
  }

  const businessDays = () =>
    app.service('businessdays') as unknown as {
      approveClosedDay: (
        data: unknown,
        params: unknown,
      ) => Promise<{ approved: boolean; businessDayId: string; role?: string }>
      openDay: (data: unknown, params: unknown) => Promise<BusinessDayRow>
      get: (id: string, params: unknown) => Promise<BusinessDayRow>
      find: (params: unknown) => Promise<BusinessDayRow[]>
      patch: (id: string, data: unknown, params: unknown) => Promise<BusinessDayRow>
      remove: (id: string, params: unknown) => Promise<unknown>
    }

  /** Eigene Filiale mit Mitarbeiter, Manager und Inhaber; räumt nach dem Test ab. */
  const closedLocation = async () => {
    const tenantId = uuidv7()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Ruhetag',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    const locationId = location._id
    await app.service('locations').patch(locationId, { settings } as never, internal)

    const createUser = async (role: string, lastName: string) =>
      (
        (await app.service('users').create(
          {
            firstName: 'Ruhetag',
            lastName,
            role,
            tenantId,
            activeLocationId: locationId,
            isPosUser: true,
            posPin: PIN,
          } as never,
          internal,
        )) as { _id: string }
      )._id
    const staffId = await createUser('tenant:staff', 'Mitarbeiter')
    const managerId = await createUser('tenant:manager', 'Manager')
    const ownerId = await createUser('tenant:owner', 'Inhaber')

    const connection = () => ({
      apiKey: true,
      deviceId: uuidv7(),
      deviceRole: 'device:pos-client',
      tenantId,
      locationId,
    })
    const days = () => businessDays().find({ ...internal, paginate: false, query: { locationId } })

    onTestFinished(async () => {
      for (const day of await days()) await businessDays().remove(day._id, internal)
      for (const id of [staffId, managerId, ownerId]) await app.service('users').remove(id, internal)
      await app.service('locations').remove(locationId, internal)
    })

    return {
      locationId,
      staffId,
      managerId,
      ownerId,
      days,
      external: () => ({ provider: 'socketio', connection: connection() }),
      approve: (authorizedByUserId: string, pin = PIN) =>
        businessDays().approveClosedDay(
          { authorizedByUserId, pin },
          { provider: 'socketio', connection: connection() },
        ),
      /** Der Order-Hook allein, mit API-Key-Kontext — so wie ein Gerät bestellt. */
      placeOrder: async (): Promise<{ businessDayId?: string }> => {
        const context = { app, params: { apiKey: true, locationId }, data: {} as { businessDayId?: string } }
        await restrictOrderToBusinessDay()(context as never)
        return context.data
      },
      setPolicy: (closedDayPolicy?: 'block') =>
        app.service('locations').patch(
          locationId,
          {
            settings: { ...settings, openingHoursSettings: { ...settings.openingHoursSettings, closedDayPolicy } },
          } as never,
          internal,
        ),
    }
  }

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    await app.teardown()
  })

  it('lehnt die Bestellung ohne Freigabe ab und eröffnet keinen Tag', async () => {
    const f = await closedLocation()
    expect(await f.placeOrder().catch((e: unknown) => e)).toMatchObject({
      code: 400,
      data: { code: AppError.LOCATION_CLOSED_TODAY },
    })
    expect(await f.days()).toEqual([])
  })

  it('lehnt die PIN eines Mitarbeiters ohne Manager- oder Inhaberrolle und eine falsche PIN ab', async () => {
    const f = await closedLocation()
    expect(await f.approve(f.staffId).catch((e: unknown) => e)).toMatchObject({
      code: 403,
      data: { code: AppError.CLOSED_DAY_ROLE_DENIED },
    })
    expect(await f.approve(f.managerId, '0000').catch((e: unknown) => e)).toMatchObject({
      code: 403,
      data: { code: AppError.CLOSED_DAY_PIN_INVALID },
    })
    expect(await f.days()).toEqual([])
  })

  it('lehnt eine externe Tageseröffnung am Ruhetag ab', async () => {
    const f = await closedLocation()
    expect(
      await businessDays()
        .openDay({}, f.external())
        .catch((e: unknown) => e),
    ).toMatchObject({
      data: { code: AppError.LOCATION_CLOSED_TODAY },
    })
    expect(await f.days()).toEqual([])
  })

  it('Manager-PIN eröffnet den Tag mit Stempel, ein externer PATCH ändert ihn nicht, danach wird angenommen', async () => {
    const f = await closedLocation()
    const result = await f.approve(f.managerId)
    expect(result).toMatchObject({ approved: true, role: 'tenant:manager' })

    expect(await businessDays().get(result.businessDayId, internal)).toMatchObject({
      status: 'open',
      openedOnClosedDayBy: f.managerId,
      openedOnClosedDayRole: 'tenant:manager',
      openedOnClosedDayDate: locationCalendarDate({ settings }),
    })

    await businessDays().patch(result.businessDayId, { openedOnClosedDayRole: 'tenant:owner' }, f.external())
    expect((await businessDays().get(result.businessDayId, internal)).openedOnClosedDayRole).toBe('tenant:manager')

    expect((await f.placeOrder()).businessDayId).toBe(result.businessDayId)
  })

  it('unter block gilt die Manager-Freigabe nicht — nur der Inhaber gibt frei', async () => {
    const f = await closedLocation()
    await f.approve(f.managerId)
    await f.setPolicy('block')

    expect(await f.placeOrder().catch((e: unknown) => e)).toMatchObject({
      data: { code: AppError.LOCATION_CLOSED_TODAY, policy: 'block' },
    })
    expect(await f.approve(f.managerId).catch((e: unknown) => e)).toMatchObject({
      data: { code: AppError.CLOSED_DAY_ROLE_DENIED },
    })

    const result = await f.approve(f.ownerId)
    expect(result).toMatchObject({ approved: true, role: 'tenant:owner' })
    // Derselbe Tag, nur neu gestempelt — kein zweiter offener Tag.
    expect((await f.days()).filter(day => day.status === 'open')).toHaveLength(1)
    expect((await f.placeOrder()).businessDayId).toBe(result.businessDayId)
  })
})
