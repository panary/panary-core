// Höchstens eine gleichzeitig offene Lade je Kassierer und Geschäftstag
// (panary/panary-core#714).
//
// `openAuthorized` legte bei jedem Aufruf eine neue Lade an. Fand der POS die
// offene Lade nicht (#713), führte „Kasse freigeben“ so zu einer zweiten.
// Über die echte Hook-Kette mit Geräte-Verbindung; jeder Test nimmt einen eigenen
// Geschäftstag und räumt seine Laden ab (testing.md §10.2).
import { Conflict } from '@feathersjs/errors'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import { AppError } from '@panary/shared-common'

import { app } from '../../../src/app'
import { autoOpenCashSession } from '../../../src/hooks/restrict-order-to-cash-session'

interface CashSessionLite {
  _id: string
  openedBy: string
  status: string
}

describe('cash-sessions — keine zweite offene Lade', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const
  const PIN = '4711'

  let locationId: string
  let cashierId: string
  let otherStaffId: string
  let managerId: string

  const deviceConnection = () => ({
    apiKey: true,
    deviceId: uuidv7(),
    deviceRole: 'device:pos-client',
    tenantId,
    locationId,
  })

  const cashSessions = () =>
    app.service('cash-sessions') as unknown as {
      openAuthorized: (data: unknown, params: unknown) => Promise<CashSessionLite>
      create: (data: unknown, params: unknown) => Promise<CashSessionLite>
      find: (params: unknown) => Promise<CashSessionLite[]>
      patch: (id: string, data: unknown, params: unknown) => Promise<CashSessionLite>
      remove: (id: string, params: unknown) => Promise<unknown>
    }

  /** Eigener Geschäftstag je Test; alle Laden darin werden danach entfernt. */
  const businessDay = () => {
    const businessDayId = uuidv7()
    onTestFinished(async () => {
      const rows = await cashSessions().find({ ...internal, paginate: false, query: { businessDayId } })
      for (const row of rows) await cashSessions().remove(row._id, internal)
    })
    return businessDayId
  }

  /** Eröffnung per Manager-PIN vom Gerät, mit dem Token des Kassierers. */
  const openFor = async (cashier: string, businessDayId: string) => {
    const connection = deviceConnection()
    const users = app.service('users') as unknown as {
      verifyPin: (data: unknown, params: unknown) => Promise<{ operatorToken?: string }>
    }
    const { operatorToken } = await users.verifyPin({ userId: cashier, pin: PIN }, { connection })
    return cashSessions().openAuthorized(
      {
        businessDayId,
        openedBy: cashier,
        openingFloatCents: 0,
        label: 'Lade Test',
        authorizedByUserId: managerId,
        pin: PIN,
      },
      { provider: 'socketio', connection, query: { operatorToken } },
    )
  }

  const openOf = async (businessDayId: string, cashier: string) =>
    cashSessions().find({
      ...internal,
      paginate: false,
      query: { businessDayId, openedBy: cashier, status: { $in: ['open', 'counting'] } },
    })

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Doppel-Lade',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id

    const createUser = async (role: string, lastName: string) =>
      (
        (await app.service('users').create(
          {
            firstName: 'Lade',
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
    cashierId = await createUser('tenant:staff', 'Kassierer')
    otherStaffId = await createUser('tenant:staff', 'Kollege')
    managerId = await createUser('tenant:manager', 'Manager')
  })

  afterAll(async () => {
    if (locationId) await app.service('locations').remove(locationId, internal)
    for (const id of [cashierId, otherStaffId, managerId]) {
      if (id) await app.service('users').remove(id, internal)
    }
    await app.teardown()
  })

  it('eine zweite Eröffnung für denselben Kassierer und Tag scheitert mit 409 und nennt die offene Lade', async () => {
    const day = businessDay()
    const first = await openFor(cashierId, day)

    const error = await openFor(cashierId, day).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Conflict)
    expect((error as Conflict).data).toEqual({ code: AppError.CASH_SESSION_ALREADY_OPEN, cashSessionId: first._id })
    expect((await openOf(day, cashierId)).map(row => row._id)).toEqual([first._id])
  })

  it('nach dem Schließen darf derselbe Kassierer am selben Tag neu eröffnen (Ladenwechsel)', async () => {
    const day = businessDay()
    const first = await openFor(cashierId, day)
    await cashSessions().patch(first._id, { status: 'closed' }, internal)

    const second = await openFor(cashierId, day)

    expect(second._id).not.toBe(first._id)
    expect((await openOf(day, cashierId)).map(row => row._id)).toEqual([second._id])
  })

  it('ein Kollege bekommt am selben Tag seine eigene Lade', async () => {
    const day = businessDay()
    await openFor(cashierId, day)

    const colleague = await openFor(otherStaffId, day)

    expect(colleague.openedBy).toBe(otherStaffId)
  })

  it('auch der interne create (Auto-Open, Admin) legt keine zweite offene Lade an', async () => {
    const day = businessDay()
    const first = await openFor(cashierId, day)

    await expect(
      cashSessions().create(
        { tenantId, locationId, businessDayId: day, label: 'Auto-Kasse', openedBy: cashierId, openingFloatCents: 0 },
        internal,
      ),
    ).rejects.toMatchObject({ data: { code: AppError.CASH_SESSION_ALREADY_OPEN, cashSessionId: first._id } })
  })

  it('zwei gleichzeitige Eröffnungen ergeben genau eine Lade', async () => {
    const day = businessDay()
    // Direkt am create, ohne die PIN-Prüfung davor: Deren bcrypt-Laufzeit staffelt
    // zwei openAuthorized-Aufrufe zufällig, und das Rennen fände nie statt.
    const open = () =>
      cashSessions().create(
        { tenantId, locationId, businessDayId: day, label: 'Lade', openedBy: cashierId, openingFloatCents: 0 },
        internal,
      )

    const results = await Promise.allSettled([open(), open(), open()])

    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected', 'rejected'])
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(Conflict)
    expect(await openOf(day, cashierId)).toHaveLength(1)
  })

  it('eine Lade im Zählen (`counting`) gilt als offen', async () => {
    const day = businessDay()
    const first = await openFor(cashierId, day)
    await cashSessions().patch(first._id, { status: 'counting' }, internal)

    await expect(openFor(cashierId, day)).rejects.toBeInstanceOf(Conflict)
  })

  it('Sync-Apply bleibt ungesperrt — ein fertiger Stand wird nicht abgelehnt', async () => {
    const day = businessDay()
    await openFor(cashierId, day)
    const now = new Date().toISOString()

    const applied = await cashSessions().create(
      {
        _id: uuidv7(),
        tenantId,
        locationId,
        businessDayId: day,
        label: 'Aus der Cloud',
        openedBy: cashierId,
        openedAt: now,
        status: 'open',
        openingFloatCents: 0,
        cashSalesCents: 0,
        cashDropsCents: 0,
        payoutsCents: 0,
        createdAt: now,
        updatedAt: now,
      },
      { ...internal, fromSync: true },
    )

    expect(applied.status).toBe('open')
  })

  it('Auto-Open übernimmt eine zeitgleich eröffnete Lade, statt die Bestellung scheitern zu lassen', async () => {
    const day = businessDay()
    const first = await openFor(cashierId, day)

    const id = await autoOpenCashSession({ app } as never, {
      tenantId,
      locationId,
      businessDayId: day,
      label: 'Auto-Kasse',
      openedBy: cashierId,
      openingFloatCents: 1000,
    })

    expect(id).toBe(first._id)
    expect(await openOf(day, cashierId)).toHaveLength(1)
  })
})
