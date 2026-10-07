// Zurechnung aus dem Bediener-Token (panary/panary-core#619, ADR 0053, Schritt 4b).
//
// Ueber die echte Hook-Kette mit Geraete-Verbindung. Geprueft wird der Kern des
// Issues: Eine gefaelschte ID im Body (`pos_current_user` am POS) wird nicht
// mehr uebernommen, wenn ein gueltiges Token den Bediener belegt — und ohne
// Token bleibt der Body-Wert stehen, statt den Aufruf abzulehnen (ADR 0053,
// Nachtrag: ein abgelehnter Outbox-Eintrag waere ein verlorener Bon).
//
// Jeder Test legt seine Zeilen selbst an und raeumt sie ab (testing.md §10.2).
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import type { Order } from '@panary/orders/domain'

import { app } from '../../../src/app'

describe('Zurechnung von Geraete-Aufrufen aus dem Bediener-Token', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const
  const PIN = '4711'

  let locationId: string
  let cashierId: string
  let otherUserId: string

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

  const deviceParams = (connection: ReturnType<typeof deviceConnection>, token?: string) =>
    ({
      provider: 'socketio',
      connection,
      ...(token ? { query: { operatorToken: token } } : {}),
    }) as never

  const orderBody = (createdBy: string, extra: Record<string, unknown> = {}) => ({
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
    creationContext: { createdBy },
    ...extra,
  })

  /** Interner Aufruf mit User — `restrictOrderToBusinessDay` braucht die Filiale. */
  const internalAs = () => ({ ...internal, user: { _id: cashierId, tenantId, locationId } }) as never

  const removeAfterTest = (id: string, service: 'orders' | 'order-interactions' = 'orders') => {
    onTestFinished(async () => {
      const target = app.service(service) as unknown as { remove: (id: string, params: unknown) => Promise<unknown> }
      await target.remove(id, internal).catch(() => undefined)
    })
  }

  const transaction = (performedBy: string) => ({
    _id: uuidv7(),
    method: 'card',
    amount: 0,
    currency: 'EUR',
    timestamp: new Date().toISOString(),
    performedBy,
  })

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Zurechnung',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id

    const createUser = async (lastName: string) =>
      (
        (await app.service('users').create(
          {
            firstName: 'Zurechnung',
            lastName,
            role: 'tenant:staff',
            tenantId,
            activeLocationId: locationId,
            isPosUser: true,
            posPin: PIN,
          } as never,
          internal,
        )) as { _id: string }
      )._id
    cashierId = await createUser('Kassierer')
    otherUserId = await createUser('Gefaelscht')
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
    for (const id of [cashierId, otherUserId]) {
      if (id) await app.service('users').remove(id, internal)
    }
    await app.teardown()
  })

  describe('orders.create — creationContext.createdBy', () => {
    it('mit Token: der Bediener aus dem Token, nicht die ID aus dem Body', async () => {
      const connection = deviceConnection()
      const token = await tokenFor(cashierId, connection)

      const created = (await app
        .service('orders')
        .create(orderBody(otherUserId) as never, deviceParams(connection, token))) as Order
      removeAfterTest(created._id)

      expect(created.creationContext?.createdBy).toBe(cashierId)
    })

    it('ohne Token: der Body-Wert bleibt — nicht abgelehnt, nicht die Geraete-ID', async () => {
      const connection = deviceConnection()

      const created = (await app
        .service('orders')
        .create(orderBody(otherUserId) as never, deviceParams(connection))) as Order
      removeAfterTest(created._id)

      expect(created.creationContext?.createdBy).toBe(otherUserId)
    })
  })

  describe('orders.patch — performedBy neuer Zahlungen', () => {
    it('mit Token: eine neue Zahlung wird dem Bediener aus dem Token zugerechnet', async () => {
      const order = (await app.service('orders').create(orderBody(cashierId) as never, internalAs())) as Order
      removeAfterTest(order._id)
      const connection = deviceConnection()
      const token = await tokenFor(cashierId, connection)

      const patched = (await app.service('orders').patch(
        order._id,
        {
          payment: { state: 'paid', totalAmount: 0, tipAmount: 0, transactions: [transaction(otherUserId)] },
        } as never,
        deviceParams(connection, token),
      )) as Order

      expect(patched.payment?.transactions?.[0]?.performedBy).toBe(cashierId)
    })

    it('eine schon gebuchte Zahlung behaelt ihren Kassierer', async () => {
      const booked = transaction(otherUserId)
      const order = (await app.service('orders').create(
        orderBody(cashierId, {
          payment: { state: 'partially_paid', totalAmount: 0, tipAmount: 0, transactions: [booked] },
        }) as never,
        internalAs(),
      )) as Order
      removeAfterTest(order._id)
      const connection = deviceConnection()
      const token = await tokenFor(cashierId, connection)

      const patched = (await app.service('orders').patch(
        order._id,
        {
          payment: {
            state: 'paid',
            totalAmount: 0,
            tipAmount: 0,
            transactions: [booked, transaction(otherUserId)],
          },
        } as never,
        deviceParams(connection, token),
      )) as Order

      expect(patched.payment?.transactions?.map(t => t.performedBy)).toEqual([otherUserId, cashierId])
    })

    it('eine schon gebuchte Zahlung laesst sich nicht umschreiben — der gespeicherte Kassierer bleibt', async () => {
      const booked = transaction(cashierId)
      const order = (await app.service('orders').create(
        orderBody(cashierId, {
          payment: { state: 'partially_paid', totalAmount: 0, tipAmount: 0, transactions: [booked] },
        }) as never,
        internalAs(),
      )) as Order
      removeAfterTest(order._id)
      const connection = deviceConnection()
      const token = await tokenFor(otherUserId, connection)

      const patched = (await app.service('orders').patch(
        order._id,
        {
          payment: {
            state: 'partially_paid',
            totalAmount: 0,
            tipAmount: 0,
            transactions: [{ ...booked, performedBy: otherUserId }],
          },
        } as never,
        deviceParams(connection, token),
      )) as Order

      expect(patched.payment?.transactions?.[0]?.performedBy).toBe(cashierId)
    })

    it('Zahlungen beim Anlegen werden ebenfalls dem Bediener aus dem Token zugerechnet', async () => {
      const connection = deviceConnection()
      const token = await tokenFor(cashierId, connection)

      const created = (await app.service('orders').create(
        orderBody(cashierId, {
          payment: { state: 'paid', totalAmount: 0, tipAmount: 0, transactions: [transaction(otherUserId)] },
        }) as never,
        deviceParams(connection, token),
      )) as Order
      removeAfterTest(created._id)

      expect(created.payment?.transactions?.[0]?.performedBy).toBe(cashierId)
    })

    it('ohne Token: der Body-Wert bleibt, der Patch geht durch', async () => {
      const order = (await app.service('orders').create(orderBody(cashierId) as never, internalAs())) as Order
      removeAfterTest(order._id)

      const patched = (await app.service('orders').patch(
        order._id,
        {
          payment: { state: 'paid', totalAmount: 0, tipAmount: 0, transactions: [transaction(otherUserId)] },
        } as never,
        deviceParams(deviceConnection()),
      )) as Order

      expect(patched.payment?.transactions?.[0]?.performedBy).toBe(otherUserId)
    })
  })

  describe('orders.patch — appliedBy neuer Rabatte (#631)', () => {
    const discount = (appliedBy: string | null, method: 'manual' | 'automatic' = 'manual') => ({
      _id: uuidv7(),
      discountId: null,
      name: 'Testrabatt',
      method,
      target: 'order',
      valueType: 'percent',
      valuePercent: 10,
      valueCents: 0,
      computedAmountCents: 0,
      appliedBy,
      appliedAt: new Date().toISOString(),
    })

    it('mit Token: ein neuer Rabatt wird dem Bediener aus dem Token zugerechnet', async () => {
      const order = (await app.service('orders').create(orderBody(cashierId) as never, internalAs())) as Order
      removeAfterTest(order._id)
      const connection = deviceConnection()
      const token = await tokenFor(cashierId, connection)

      const patched = (await app
        .service('orders')
        .patch(
          order._id,
          { appliedDiscounts: [discount(otherUserId)] } as never,
          deviceParams(connection, token),
        )) as Order

      expect(patched.appliedDiscounts?.[0]?.appliedBy).toBe(cashierId)
    })

    it('ein schon vergebener Rabatt behaelt seinen Urheber', async () => {
      const given = discount(cashierId)
      const order = (await app
        .service('orders')
        .create(orderBody(cashierId, { appliedDiscounts: [given] }) as never, internalAs())) as Order
      removeAfterTest(order._id)
      const connection = deviceConnection()
      const token = await tokenFor(otherUserId, connection)

      const patched = (await app
        .service('orders')
        .patch(
          order._id,
          { appliedDiscounts: [{ ...given, appliedBy: otherUserId }] } as never,
          deviceParams(connection, token),
        )) as Order

      expect(patched.appliedDiscounts?.[0]?.appliedBy).toBe(cashierId)
    })

    it('ein manueller Rabatt ohne appliedBy im Body bekommt den Bediener aus dem Token', async () => {
      const order = (await app.service('orders').create(orderBody(cashierId) as never, internalAs())) as Order
      removeAfterTest(order._id)
      const connection = deviceConnection()
      const token = await tokenFor(cashierId, connection)

      const patched = (await app
        .service('orders')
        .patch(order._id, { appliedDiscounts: [discount(null)] } as never, deviceParams(connection, token))) as Order

      expect(patched.appliedDiscounts?.[0]?.appliedBy).toBe(cashierId)
    })

    it('ein automatischer Rabatt bekommt keinen Bediener zugerechnet', async () => {
      const order = (await app.service('orders').create(orderBody(cashierId) as never, internalAs())) as Order
      removeAfterTest(order._id)
      const connection = deviceConnection()
      const token = await tokenFor(cashierId, connection)

      const patched = (await app
        .service('orders')
        .patch(
          order._id,
          { appliedDiscounts: [discount(null, 'automatic')] } as never,
          deviceParams(connection, token),
        )) as Order

      expect(patched.appliedDiscounts?.[0]?.appliedBy ?? null).toBeNull()
    })
  })

  describe('order-interactions.create — userId im Journal', () => {
    const interaction = (userId: string, orderId: string) => ({
      type: 'order-cancel',
      orderId,
      userId,
      eventAt: new Date().toISOString(),
      orderOpenedAt: new Date().toISOString(),
    })

    it('mit Token: das Journal traegt den Bediener aus dem Token', async () => {
      const order = (await app.service('orders').create(orderBody(cashierId) as never, internalAs())) as Order
      removeAfterTest(order._id)
      const connection = deviceConnection()
      const token = await tokenFor(cashierId, connection)

      const created = (await app
        .service('order-interactions')
        .create(interaction(otherUserId, order._id) as never, deviceParams(connection, token))) as {
        _id: string
        userId: string
      }
      removeAfterTest(created._id, 'order-interactions')

      expect(created.userId).toBe(cashierId)
    })

    it('ohne Token: der Body-Wert bleibt', async () => {
      const order = (await app.service('orders').create(orderBody(cashierId) as never, internalAs())) as Order
      removeAfterTest(order._id)

      const created = (await app
        .service('order-interactions')
        .create(interaction(otherUserId, order._id) as never, deviceParams(deviceConnection()))) as {
        _id: string
        userId: string
      }
      removeAfterTest(created._id, 'order-interactions')

      expect(created.userId).toBe(otherUserId)
    })
  })
})
