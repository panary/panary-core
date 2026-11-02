// Gebuchte Zahlung einer abgeschlossenen Bestellung (panary/panary-core#1300).
//
// Zwei Kassen kassieren dieselbe Bestellung kurz nacheinander. Vorher lief der
// zweite Patch `{ payment, status: 'completed' }` durch und ersetzte die Zahlung
// der ersten Kasse samt Kassierer — die Kassenabstimmung zaehlte den Betrag bei
// der falschen Lade. Geprueft wird ueber die echte Hook-Kette, und zwar am
// gespeicherten Stand, nicht nur am Statuscode.
//
// Jeder Test legt seine Zeilen selbst an und raeumt sie ab (testing.md §10.2).
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import type { Order } from '@panary/orders/domain'
import { AppError } from '@panary/shared-common'

import { app } from '../../../src/app'

describe('orders.patch — Zahlung einer abgeschlossenen Bestellung', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const

  let locationId: string
  let firstCashierId: string
  let secondCashierId: string

  const deviceParams = () =>
    ({
      provider: 'socketio',
      connection: { apiKey: true, deviceId: uuidv7(), deviceRole: 'device:pos-client', tenantId, locationId },
    }) as never

  const internalAs = () => ({ ...internal, user: { _id: firstCashierId, tenantId, locationId } }) as never

  const payment = (performedBy: string, amount = 12.5) => ({
    state: 'paid',
    totalAmount: amount,
    tipAmount: 0,
    transactions: [
      { _id: uuidv7(), method: 'card', amount, currency: 'EUR', timestamp: new Date().toISOString(), performedBy },
    ],
  })

  const createOpenOrder = async (): Promise<Order> => {
    const order = (await app.service('orders').create(
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
        creationContext: { createdBy: firstCashierId },
      } as never,
      internalAs(),
    )) as Order
    onTestFinished(async () => {
      await app
        .service('orders')
        .remove(order._id, internal)
        .catch(() => undefined)
    })
    return order
  }

  /** Kassieren wie `OrderCheckoutService.payCash`: Zahlung und Status in einem Patch. */
  const checkout = (orderId: string, body: ReturnType<typeof payment>) =>
    app.service('orders').patch(orderId, { payment: body, status: 'completed' } as never, deviceParams())

  const storedPayment = async (orderId: string) =>
    ((await app.service('orders').get(orderId, internal)) as Order).payment

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Zahlungssperre',
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
            firstName: 'Zahlungssperre',
            lastName,
            role: 'tenant:staff',
            tenantId,
            activeLocationId: locationId,
            isPosUser: true,
            posPin: '4711',
          } as never,
          internal,
        )) as { _id: string }
      )._id
    firstCashierId = await createUser('Kasse1')
    secondCashierId = await createUser('Kasse2')
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
    for (const id of [firstCashierId, secondCashierId]) {
      if (id) await app.service('users').remove(id, internal)
    }
    await app.teardown()
  })

  it('zweites Kassieren an einer anderen Kasse wird abgelehnt — die erste Zahlung bleibt gebucht', async () => {
    const order = await createOpenOrder()
    const first = payment(firstCashierId)
    await checkout(order._id, first)

    await expect(checkout(order._id, payment(secondCashierId))).rejects.toMatchObject({
      code: 400,
      data: { code: AppError.ORDER_ALREADY_SETTLED },
    })

    expect(await storedPayment(order._id)).toEqual(first)
  })

  it('zwei Kassen gleichzeitig: genau eine Zahlung wird gebucht, die andere abgelehnt', async () => {
    const order = await createOpenOrder()
    const first = payment(firstCashierId)
    const second = payment(secondCashierId)

    const results = await Promise.allSettled([checkout(order._id, first), checkout(order._id, second)])

    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const winner = results[0].status === 'fulfilled' ? first : second
    expect(await storedPayment(order._id)).toEqual(winner)
  })

  it('ein Patch nur mit `payment` auf eine abgeschlossene Bestellung wird ebenso abgelehnt', async () => {
    const order = await createOpenOrder()
    const first = payment(firstCashierId)
    await checkout(order._id, first)

    await expect(
      app.service('orders').patch(order._id, { payment: payment(secondCashierId, 99) } as never, deviceParams()),
    ).rejects.toMatchObject({ code: 400, data: { code: AppError.ORDER_ALREADY_SETTLED } })

    expect(await storedPayment(order._id)).toEqual(first)
  })

  it('auch eine nicht abgeholte Bestellung (unclaimed) behaelt ihre Zahlung', async () => {
    const order = await createOpenOrder()
    const first = payment(firstCashierId)
    await checkout(order._id, first)
    await app.service('orders').patch(order._id, { status: 'unclaimed' } as never, internal)

    await expect(
      app.service('orders').patch(order._id, { payment: payment(secondCashierId) } as never, deviceParams()),
    ).rejects.toMatchObject({ code: 400, data: { code: AppError.ORDER_ALREADY_SETTLED } })

    expect(await storedPayment(order._id)).toEqual(first)
  })

  it('dieselbe Zahlung noch einmal (verlorene Antwort, Wiederholung) geht durch und aendert nichts', async () => {
    const order = await createOpenOrder()
    const first = payment(firstCashierId)
    await checkout(order._id, first)

    const replayed = (await checkout(order._id, { ...first, totalAmount: 0 })) as Order

    expect(replayed.status).toBe('completed')
    expect(await storedPayment(order._id)).toEqual(first)
  })

  it('interne Aufrufe (Sync-Apply) duerfen die Zahlung weiter setzen', async () => {
    const order = await createOpenOrder()
    await checkout(order._id, payment(firstCashierId))
    const fromCloud = payment(secondCashierId, 7)

    await app.service('orders').patch(order._id, { payment: fromCloud } as never, internal)

    expect(await storedPayment(order._id)).toEqual(fromCloud)
  })
})
