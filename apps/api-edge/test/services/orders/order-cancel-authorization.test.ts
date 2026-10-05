// Storno von Geraeten nur mit belegter Freigabe (panary/panary-core#619, ADR 0053, Schritt 4).
//
// Ueber die echte Hook-Kette mit Geraete-Verbindung: `allowApiKey` setzt den
// Geraete-User, `resolvePosOperator` wertet das Token aus, der `orders`-Patch
// entscheidet. Gerade die Verdrahtung ist der Punkt — vorher entschied allein
// der POS, und eine gefaelschte `pos_current_user._id` reichte fuer einen Storno.
//
// Jeder Test legt seine Order selbst an und raeumt sie ab (testing.md §10.2).
import { Forbidden } from '@feathersjs/errors'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import type { Order } from '@panary/orders/domain'

import { app } from '../../../src/app'

describe('orders.patch — Storno von Geraeten verlangt ein Manager-Token', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const
  const PIN = '4711'

  let locationId: string
  let managerId: string
  let staffId: string

  const deviceConnection = () => ({
    apiKey: true,
    deviceId: uuidv7(),
    deviceRole: 'device:pos-client',
    tenantId,
    locationId,
  })

  const createOrder = async () => {
    const created = (await app.service('orders').create(
      {
        tenantId,
        locationId,
        status: 'active',
        orderChannel: 'pos',
        dineLocation: 'dine-in',
        lineItems: [],
        isFinished: false,
        estimatedDuration: 0,
        remainingTime: 0,
        recordingDate: new Date().toISOString(),
      } as never,
      { ...internal, user: { _id: staffId, tenantId, locationId } } as never,
    )) as Order
    onTestFinished(async () => {
      await app
        .service('orders')
        .remove(created._id, internal)
        .catch(() => undefined)
    })
    return created
  }

  const tokenFor = async (userId: string, connection: ReturnType<typeof deviceConnection>) => {
    const service = app.service('users') as unknown as {
      verifyPin: (data: unknown, params: unknown) => Promise<{ operatorToken?: string }>
    }
    return (await service.verifyPin({ userId, pin: PIN }, { connection })).operatorToken as string
  }

  const cancelAsDevice = (orderId: string, connection: ReturnType<typeof deviceConnection>, token?: string) =>
    app.service('orders').patch(
      orderId,
      {
        status: 'aborted',
        cancellation: { canceledBy: 'Test', reason: 'Test', canceledAt: new Date().toISOString() },
      } as never,
      {
        provider: 'socketio',
        connection,
        ...(token === undefined ? {} : { query: { operatorToken: token } }),
      } as never,
    )

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Storno-Freigabe',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id

    const createUser = async (role: string) =>
      (
        (await app.service('users').create(
          {
            firstName: 'Storno',
            lastName: role,
            role,
            tenantId,
            activeLocationId: locationId,
            isPosUser: true,
            posPin: PIN,
          } as never,
          internal,
        )) as { _id: string }
      )._id
    managerId = await createUser('tenant:manager')
    staffId = await createUser('tenant:staff')
  })

  afterAll(async () => {
    if (locationId) {
      const days = (await app.service('businessdays').find({
        ...internal,
        paginate: false,
        query: { locationId },
      })) as Array<{ _id: string }>
      for (const day of days) {
        await app.service('businessdays').remove(day._id, { ...internal, isEmergencyOverride: true } as never)
      }
      await app.service('locations').remove(locationId, internal)
    }
    for (const id of [managerId, staffId]) {
      if (id) await app.service('users').remove(id, internal)
    }
    await app.teardown()
  })

  it('mit Token eines Managers: Storno geht durch', async () => {
    const order = await createOrder()
    const connection = deviceConnection()
    const token = await tokenFor(managerId, connection)

    const patched = (await cancelAsDevice(order._id, connection, token)) as Order

    expect(patched.status).toBe('aborted')
  })

  it('ohne Token: abgelehnt, die Order bleibt aktiv', async () => {
    const order = await createOrder()

    await expect(cancelAsDevice(order._id, deviceConnection())).rejects.toBeInstanceOf(Forbidden)
    const stored = (await app.service('orders').get(order._id, internal)) as Order
    expect(stored.status).toBe('active')
  })

  it('mit Token eines Kassierers: abgelehnt — die Rolle entscheidet, nicht das Vorhandensein', async () => {
    const order = await createOrder()
    const connection = deviceConnection()
    const token = await tokenFor(staffId, connection)

    await expect(cancelAsDevice(order._id, connection, token)).rejects.toBeInstanceOf(Forbidden)
  })

  it('mit ungueltigem Token: abgelehnt', async () => {
    const order = await createOrder()

    await expect(cancelAsDevice(order._id, deviceConnection(), 'kein.gueltiges.token')).rejects.toBeInstanceOf(
      Forbidden,
    )
  })

  it('andere Patches eines Geraets brauchen kein Token', async () => {
    const order = await createOrder()

    const patched = (await app.service('orders').patch(
      order._id,
      { status: 'production' } as never,
      {
        provider: 'socketio',
        connection: deviceConnection(),
      } as never,
    )) as Order

    expect(patched.status).toBe('production')
  })
})
