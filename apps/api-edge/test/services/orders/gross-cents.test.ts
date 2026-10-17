import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { onTestFinished } from 'vitest'
import type { Knex } from 'knex'
import { getOrderGrossCents, Order } from '@panary/orders/domain'
import { app } from '../../../src/app'

// Gespeichertes Brutto je Bestellung (panary/panary-core#728): laeuft gegen die
// echte, migrierte Test-SQLite und die VOLLE Hook-Kette des orders-Service.
//
// Jede Zusicherung liest die Spalte zusaetzlich roh aus der Datenbank. Das
// Service-Ergebnis allein bewiese nur, dass der Hook den Wert in `context.data`
// legt — nicht, dass er in der Spalte ankommt, die der Sync-Push liest.
//
// Jeder Test legt seine eigene Order an (testing.md §10.2). Die Filiale steht auf
// `orders-only`, weil der Split nur im Bestellbetrieb erlaubt ist.
describe('orders service — gespeichertes Brutto (grossCents)', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const

  let locationId: string
  let userId: string

  const lineItem = (price: number, amount = 1) => ({
    _id: uuidv7(),
    externalId: uuidv7(),
    productGroupExternalId: uuidv7(),
    name: 'Brutto-Testprodukt',
    amount,
    price,
    modifiers: [],
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: 19,
    taxOutside: 7,
    topic: 'kitchen',
    bundleNumber: null,
  })

  const userParams = () => ({ ...internal, user: { _id: userId, tenantId, locationId } }) as never

  /** 2 × 20,00 € @19 % (dine-in) + optionale weitere Zeilen; raeumt am Ende DIESES Tests ab. */
  const createOrder = async (extra: Record<string, unknown> = {}, lineItems = [lineItem(20, 2)]) => {
    const created = (await app.service('orders').create(
      {
        tenantId,
        locationId,
        status: 'active',
        orderChannel: 'pos',
        dineLocation: 'dine-in',
        lineItems,
        isFinished: false,
        estimatedDuration: 0,
        remainingTime: 0,
        recordingDate: new Date().toISOString(),
        ...extra,
      } as never,
      userParams(),
    )) as Order

    onTestFinished(async () => {
      await app
        .service('orders')
        .remove(created._id, internal)
        .catch(() => undefined)
    })

    return created
  }

  const storedGrossCents = async (orderId: string): Promise<unknown> => {
    const db = app.get('sqliteClient') as Knex
    const row = await db('orders').where({ _id: orderId }).first('grossCents')
    return row?.grossCents
  }

  beforeAll(async () => {
    await app.setup()

    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale grossCents',
        tenantId,
        operationMode: 'orders-only',
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id

    const user = (await app.service('users').create(
      {
        firstName: 'Brutto',
        lastName: 'Tester',
        role: 'tenant:staff',
        tenantId,
        activeLocationId: locationId,
      } as never,
      internal,
    )) as { _id: string }
    userId = user._id
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
    if (userId) await app.service('users').remove(userId, internal)
    await app.teardown()
  })

  it('create stempelt das Brutto aus der kanonischen Funktion in die Spalte', async () => {
    const order = await createOrder()

    assert.strictEqual(order.grossCents, 4000)
    assert.strictEqual(order.grossCents, getOrderGrossCents(order))
    assert.strictEqual(await storedGrossCents(order._id), 4000)
  })

  it('create ueberschreibt einen mitgeschickten Wert', async () => {
    const order = await createOrder({ grossCents: 1 })

    assert.strictEqual(await storedGrossCents(order._id), 4000)
  })

  it('patch mit Rabatt rechnet das Brutto neu', async () => {
    const order = await createOrder()

    const patched = (await app.service('orders').patch(
      order._id,
      {
        appliedDiscounts: [
          {
            _id: uuidv7(),
            discountId: null,
            name: 'Halber Preis',
            method: 'manual',
            target: 'order',
            valueType: 'percent',
            valuePercent: 50,
            valueCents: 0,
            computedAmountCents: 0,
            appliedAt: new Date().toISOString(),
          },
        ],
      } as never,
      internal,
    )) as Order

    assert.strictEqual(patched.grossCents, 2000)
    assert.strictEqual(await storedGrossCents(order._id), 2000)
  })

  it('patch mit Zahlung: der gezahlte Betrag gewinnt vor dem taxSnapshot', async () => {
    const order = await createOrder()

    await app.service('orders').patch(
      order._id,
      {
        payment: {
          state: 'paid',
          totalAmount: 37.5,
          tipAmount: 0,
          transactions: [
            { _id: uuidv7(), method: 'card', amount: 37.5, currency: 'EUR', timestamp: new Date().toISOString() },
          ],
        },
      } as never,
      internal,
    )

    assert.strictEqual(await storedGrossCents(order._id), 3750)
  })

  it('patch mit Platzhalter-Zahlung faellt auf den taxSnapshot zurueck', async () => {
    const order = await createOrder()

    await app
      .service('orders')
      .patch(
        order._id,
        { payment: { state: 'pending', totalAmount: 0, tipAmount: 0, transactions: [] } } as never,
        internal,
      )

    assert.strictEqual(await storedGrossCents(order._id), 4000)
  })

  it('patch ohne Preisbezug haelt das Brutto und ueberschreibt einen mitgeschickten Wert', async () => {
    const order = await createOrder()

    await app.service('orders').patch(order._id, { pager: 7, grossCents: 1 } as never, internal)

    assert.strictEqual(await storedGrossCents(order._id), 4000)
  })

  it('split: Quelle und Ziel tragen danach je ihr eigenes Brutto', async () => {
    const kept = lineItem(20)
    const moved = lineItem(10)
    const source = await createOrder({}, [kept, moved])
    assert.strictEqual(await storedGrossCents(source._id), 3000)

    const result = (await (app.service('orders') as any).split(
      { orderId: source._id, lineItems: [{ lineItemRowId: moved._id }] },
      userParams(),
    )) as { sourceOrder: Order; targetOrder: Order }
    onTestFinished(async () => {
      await app
        .service('orders')
        .remove(result.targetOrder._id, internal)
        .catch(() => undefined)
    })

    assert.strictEqual(await storedGrossCents(source._id), 2000)
    assert.strictEqual(await storedGrossCents(result.targetOrder._id), 1000)
  })
})
