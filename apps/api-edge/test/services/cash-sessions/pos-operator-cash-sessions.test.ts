// Kassenlade und Bediener-Token (panary/panary-core#631, ADR 0053).
//
// `openAuthorized` eroeffnet die Lade auf den Kassierer (`openedBy`), die
// Besitzer-Pruefung verglich bei Geraeten aber mit `device:<uuid>` — ein POS fand
// die Lade seines Kassierers nie und konnte sie nicht schliessen. Seit #631 ist bei
// Geraeten „ich“ der per Token belegte Bediener; ohne Token bleibt alles wie bisher.
//
// Ueber die echte Hook-Kette mit Geraete-Verbindung. Jeder Test legt seine Lade
// selbst an und raeumt sie ab (testing.md §10.2).
import { Forbidden } from '@feathersjs/errors'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import { app } from '../../../src/app'

interface CashSessionLite {
  _id: string
  openedBy: string
  closedBy?: string | null
  status: string
}

describe('cash-sessions — Bediener-Token am Geraet', () => {
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

  const tokenFor = async (userId: string, connection: ReturnType<typeof deviceConnection>) => {
    const service = app.service('users') as unknown as {
      verifyPin: (data: unknown, params: unknown) => Promise<{ operatorToken?: string }>
    }
    return (await service.verifyPin({ userId, pin: PIN }, { connection })).operatorToken as string
  }

  const deviceParams = (connection: ReturnType<typeof deviceConnection>, token?: string, query = {}) =>
    ({
      provider: 'socketio',
      connection,
      query: { ...query, ...(token ? { operatorToken: token } : {}) },
    }) as never

  const cashSessions = () =>
    app.service('cash-sessions') as unknown as {
      openAuthorized: (data: unknown, params: unknown) => Promise<CashSessionLite>
      find: (params: unknown) => Promise<CashSessionLite[] | { data: CashSessionLite[] }>
      patch: (id: string, data: unknown, params: unknown) => Promise<CashSessionLite>
      remove: (id: string, params: unknown) => Promise<unknown>
    }

  /** Lade fuer den Kassierer, eroeffnet per Manager-PIN vom Geraet mit Kassierer-Token. */
  const openDrawerFor = async (cashier: string, claimedOpenedBy = cashier) => {
    const connection = deviceConnection()
    const token = await tokenFor(cashier, connection)
    const drawer = await cashSessions().openAuthorized(
      {
        businessDayId: uuidv7(),
        openedBy: claimedOpenedBy,
        openingFloatCents: 0,
        label: 'Lade Test',
        authorizedByUserId: managerId,
        pin: PIN,
      },
      deviceParams(connection, token),
    )
    onTestFinished(async () => {
      await cashSessions()
        .remove(drawer._id, internal)
        .catch(() => undefined)
    })
    return { drawer, connection, token }
  }

  const listOf = (res: CashSessionLite[] | { data: CashSessionLite[] }) => (Array.isArray(res) ? res : res.data)

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Kassenlade',
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
            firstName: 'Kasse',
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

  it('openAuthorized: die Lade gehoert dem Bediener aus dem Token, nicht der ID im Body', async () => {
    const { drawer } = await openDrawerFor(cashierId, otherStaffId)

    expect(drawer.openedBy).toBe(cashierId)
  })

  it('mit Token findet das Geraet die Lade seines Kassierers', async () => {
    const { drawer, connection, token } = await openDrawerFor(cashierId)

    const found = listOf(await cashSessions().find(deviceParams(connection, token, { _id: drawer._id })))

    expect(found.map(d => d._id)).toEqual([drawer._id])
  })

  it('ohne Token sieht das Geraet die Lade nicht — wie bisher', async () => {
    const { drawer } = await openDrawerFor(cashierId)

    const found = listOf(await cashSessions().find(deviceParams(deviceConnection(), undefined, { _id: drawer._id })))

    expect(found).toEqual([])
  })

  it('mit Token schliesst das Geraet die Lade, closedBy ist der Bediener aus dem Token', async () => {
    const { drawer, connection, token } = await openDrawerFor(cashierId)

    const closed = await cashSessions().patch(
      drawer._id,
      { status: 'closed', closedBy: otherStaffId },
      deviceParams(connection, token),
    )

    expect(closed.closedBy).toBe(cashierId)
  })

  it('das Token eines Kollegen oeffnet die Lade des Kassierers nicht', async () => {
    const { drawer } = await openDrawerFor(cashierId)
    const connection = deviceConnection()
    const colleagueToken = await tokenFor(otherStaffId, connection)

    await expect(
      cashSessions().patch(drawer._id, { status: 'closed' }, deviceParams(connection, colleagueToken)),
    ).rejects.toBeInstanceOf(Forbidden)
  })
})
