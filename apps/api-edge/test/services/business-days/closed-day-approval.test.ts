// Ruhetag-Gate gegen die migrierte SQLite und die echte Hook-Kette
// (panary/panary-core#1133, ADR 0062).
//
// Die Filiale ist an JEDEM Wochentag geschlossen, damit „heute" unabhängig vom
// Testdatum Ruhetag ist. Kein CONNECTED-Pairing (geteilte Test-SQLite, siehe
// close-day-outbox-guard.test.ts) — es ist also der Standalone-Pfad, in dem die
// Freigabe den Tag selbst eröffnet.
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const
  const PIN = '2580'

  let locationId: string
  let staffId: string
  let managerId: string
  let ownerId: string
  let settings: typeof generateDefaultLocationSettings

  const deviceConnection = () => ({
    apiKey: true,
    deviceId: uuidv7(),
    deviceRole: 'device:pos-client',
    tenantId,
    locationId,
  })

  const businessDays = () =>
    app.service('businessdays') as unknown as {
      approveClosedDay: (data: unknown, params: unknown) => Promise<{ approved: boolean; businessDayId: string; role?: string }>
      get: (id: string, params: unknown) => Promise<BusinessDayRow>
      find: (params: unknown) => Promise<BusinessDayRow[]>
      patch: (id: string, data: unknown, params: unknown) => Promise<BusinessDayRow>
      remove: (id: string, params: unknown) => Promise<unknown>
    }

  const approve = (authorizedByUserId: string, pin = PIN) =>
    businessDays().approveClosedDay(
      { authorizedByUserId, pin },
      { provider: 'socketio', connection: deviceConnection() },
    )

  /** Der Order-Hook allein, mit API-Key-Kontext — so wie ein Gerät bestellt. */
  const placeOrder = async (): Promise<{ businessDayId?: string }> => {
    const context = { app, params: { apiKey: true, locationId }, data: {} as { businessDayId?: string } }
    await restrictOrderToBusinessDay()(context as never)
    return context.data
  }

  const daysOfLocation = () => businessDays().find({ ...internal, paginate: false, query: { locationId } })

  const setPolicy = (closedDayPolicy?: 'block') =>
    app.service('locations').patch(
      locationId,
      { settings: { ...settings, openingHoursSettings: { ...settings.openingHoursSettings, closedDayPolicy } } } as never,
      internal,
    )

  beforeAll(async () => {
    await app.setup()
    settings = {
      ...generateDefaultLocationSettings,
      openingHoursSettings: {
        enabled: true,
        regular: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open: '10:00', close: '22:00', closed: true })),
      },
    }
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Ruhetag',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id
    await setPolicy()

    const createUser = async (role: string, lastName: string) =>
      (
        (await app.service('users').create(
          { firstName: 'Ruhetag', lastName, role, tenantId, activeLocationId: locationId, isPosUser: true, posPin: PIN } as never,
          internal,
        )) as { _id: string }
      )._id
    staffId = await createUser('tenant:staff', 'Mitarbeiter')
    managerId = await createUser('tenant:manager', 'Manager')
    ownerId = await createUser('tenant:owner', 'Inhaber')
  })

  afterAll(async () => {
    if (locationId) {
      for (const day of await daysOfLocation()) await businessDays().remove(day._id, internal)
      await app.service('locations').remove(locationId, internal)
    }
    for (const id of [staffId, managerId, ownerId]) if (id) await app.service('users').remove(id, internal)
    await app.teardown()
  })

  it('lehnt die Bestellung ohne Freigabe ab und eröffnet keinen Tag', async () => {
    const error = await placeOrder().catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 400, data: { code: AppError.LOCATION_CLOSED_TODAY } })
    expect(await daysOfLocation()).toEqual([])
  })

  it('lehnt die PIN eines Mitarbeiters ohne Manager- oder Inhaberrolle ab', async () => {
    const error = await approve(staffId).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 403, data: { code: AppError.CLOSED_DAY_ROLE_DENIED } })
    expect(await daysOfLocation()).toEqual([])
  })

  it('lehnt eine falsche PIN ab', async () => {
    const error = await approve(managerId, '0000').catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 403, data: { code: AppError.CLOSED_DAY_PIN_INVALID } })
  })

  it('Manager-PIN eröffnet den Tag mit Stempel, danach wird angenommen', async () => {
    const result = await approve(managerId)
    expect(result).toMatchObject({ approved: true, role: 'tenant:manager' })

    const day = await businessDays().get(result.businessDayId, internal)
    expect(day).toMatchObject({
      status: 'open',
      openedOnClosedDayBy: managerId,
      openedOnClosedDayRole: 'tenant:manager',
      openedOnClosedDayDate: locationCalendarDate({ settings }),
    })

    expect((await placeOrder()).businessDayId).toBe(result.businessDayId)
  })

  it('ein externer PATCH kann den Stempel nicht setzen', async () => {
    const [day] = await daysOfLocation()
    await businessDays().patch(
      day._id,
      { openedOnClosedDayRole: 'tenant:owner' },
      { provider: 'socketio', connection: deviceConnection() },
    )
    expect((await businessDays().get(day._id, internal)).openedOnClosedDayRole).toBe('tenant:manager')
  })

  it('unter block gilt die Manager-Freigabe nicht mehr — nur der Inhaber gibt frei', async () => {
    await setPolicy('block')

    expect(await placeOrder().catch((e: unknown) => e)).toMatchObject({
      data: { code: AppError.LOCATION_CLOSED_TODAY, policy: 'block' },
    })
    expect(await approve(managerId).catch((e: unknown) => e)).toMatchObject({
      data: { code: AppError.CLOSED_DAY_ROLE_DENIED },
    })

    const result = await approve(ownerId)
    expect(result).toMatchObject({ approved: true, role: 'tenant:owner' })
    // Derselbe Tag, nur neu gestempelt — kein zweiter offener Tag.
    expect((await daysOfLocation()).filter(day => day.status === 'open')).toHaveLength(1)
    expect((await placeOrder()).businessDayId).toBe(result.businessDayId)
  })
})
