import { Conflict } from '@feathersjs/errors'
import { uuidv7 } from 'uuidv7'
import { onTestFinished } from 'vitest'

import { Order } from '@panary/orders/domain'
import { AppError } from '@panary/shared-common'

import { app } from '../../../src/app'

// Doppelte Bestell-ID (panary/panary-core#1351): Der POS schickt nach einer Frist oder Trennung dieselbe `_id`
// noch einmal. Die Edge muss sie mit 409 ablehnen, BEVOR Vorgangsnummer, Fiskalzähler und TSE-Start laufen.
// Gegen die echte, migrierte Test-SQLite und die volle Hook-Kette des orders-Service.
//
// Die Vorgangsnummer ist der messbare Zeuge der Reihenfolge: Läuft der abgelehnte Versuch durch
// `assignDailySequenceNumber`, hinterlässt er eine Lücke, und die nächste Bestellung springt um zwei.
//
// Filiale und User im `beforeAll` sind Aufbau, den kein Test verändert (testing.md §10.2).
describe('orders service — doppelte _id', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const

  let locationId: string
  let userId: string

  const lineItem = () => ({
    _id: uuidv7(),
    externalId: uuidv7(),
    productGroupExternalId: uuidv7(),
    name: 'Doppel-ID-Testprodukt',
    amount: 1,
    price: 10,
    modifiers: [],
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: 19,
    taxOutside: 7,
    topic: 'kitchen',
    bundleNumber: null,
  })

  const createOrder = async (
    id?: string,
    over: Record<string, unknown> = {},
    params: Record<string, unknown> = {},
  ): Promise<Order> => {
    const created = (await app.service('orders').create(
      {
        ...(id ? { _id: id } : {}),
        tenantId,
        locationId,
        status: 'active',
        orderChannel: 'pos',
        dineLocation: 'dine-in',
        lineItems: [lineItem()],
        isFinished: false,
        estimatedDuration: 0,
        remainingTime: 0,
        recordingDate: new Date().toISOString(),
        ...over,
      } as never,
      { ...internal, user: { _id: userId, tenantId, locationId }, ...params } as never,
    )) as Order

    onTestFinished(async () => {
      await app
        .service('orders')
        .remove(created._id, internal)
        .catch(() => undefined)
    })

    return created
  }

  const countWithId = async (id: string): Promise<number> => {
    const rows = (await app.service('orders').find({ ...internal, paginate: false, query: { _id: id } } as never)) as
      Order[] | { data: Order[] }
    return (Array.isArray(rows) ? rows : rows.data).length
  }

  beforeAll(async () => {
    await app.setup()

    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Doppel-ID',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id

    const user = (await app.service('users').create(
      {
        firstName: 'Doppel',
        lastName: 'Id',
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
  })

  it('lehnt eine schon gespeicherte _id mit 409 und Code ORDER_ALREADY_EXISTS ab', async () => {
    const id = uuidv7()
    await createOrder(id)

    const error = await createOrder(id).then(
      () => undefined,
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(Conflict)
    expect((error as Conflict).code).toBe(409)
    expect((error as Conflict).data).toEqual({ code: AppError.ORDER_ALREADY_EXISTS, orderId: id })
    expect(await countWithId(id)).toBe(1)
  })

  it('verbraucht beim abgelehnten Versuch keine Vorgangsnummer', async () => {
    const id = uuidv7()
    const first = await createOrder(id)
    await createOrder(id).catch(() => undefined)
    const next = await createOrder()

    expect(next.dailySequenceNumber).toBe(first.dailySequenceNumber + 1)
  })

  it('lässt von zwei gleichzeitigen Versuchen mit derselben _id genau einen durch', async () => {
    // Erst den Geschäftstag sicher anlegen lassen, sonst misst der Test die Tagesrotation mit.
    await createOrder()
    const id = uuidv7()

    const results = await Promise.allSettled([createOrder(id), createOrder(id)])

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect((rejected[0].reason as Conflict).data).toEqual({ code: AppError.ORDER_ALREADY_EXISTS, orderId: id })
    expect(await countWithId(id)).toBe(1)
  })

  it('lässt die Wiederholung durch, wenn der gleichzeitige erste Versuch scheitert', async () => {
    // Eine sofortige 409 ließe den POS eine Bestellung übernehmen, die es nie gibt.
    await createOrder()
    const id = uuidv7()

    const [failed, retried] = await Promise.allSettled([createOrder(id, { status: 'kaputt' }), createOrder(id)])

    expect(failed.status).toBe('rejected')
    expect((failed as PromiseRejectedResult).reason).not.toBeInstanceOf(Conflict)
    expect(retried.status).toBe('fulfilled')
    expect(await countWithId(id)).toBe(1)
  })

  it('gibt die _id nach einem gescheiterten Versuch für den nächsten frei', async () => {
    const id = uuidv7()
    await createOrder(id, { status: 'kaputt' }).catch(() => undefined)

    const retried = await createOrder(id)

    expect(retried._id).toBe(id)
  })

  it('prüft Sync-Applies nicht: Dort entscheidet der Sync über eine vorhandene _id', async () => {
    const id = uuidv7()
    await createOrder(id)

    const error = await createOrder(id, {}, { fromSync: true }).then(
      () => undefined,
      (e: unknown) => e,
    )

    expect(error).toBeDefined()
    expect(error).not.toBeInstanceOf(Conflict)
  })

  it('lässt Bestellungen ohne mitgeschickte _id unverändert durch', async () => {
    const a = await createOrder()
    const b = await createOrder()

    expect(a._id).not.toBe(b._id)
    expect(b.dailySequenceNumber).toBe(a.dailySequenceNumber + 1)
  })
})
