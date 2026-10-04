import { uuidv7 } from 'uuidv7'
import { onTestFinished } from 'vitest'
import { Order } from '@panary/orders/domain'
import { app } from '../../../src/app'
import { resetDailySequenceMemory } from '../../../src/hooks/assign-daily-sequence-number'

// Integrationstest fuer die Vorgangsnummer je Geschaeftstag (panary/panary-core#537):
// laeuft gegen die echte Test-SQLite und die VOLLE Hook-Kette des orders-Service.
//
// Der alte Hook baute die Nummer aus Minute+Sekunde und zaehlte die Basis statt des
// Kandidaten — ab der dritten Bestellung derselben Sekunde kam dieselbe Nummer
// heraus. Diese Suite legt deshalb mehrere Bestellungen direkt hintereinander an
// (sicher innerhalb einer Sekunde) und parallel (Rennen zwischen Vergabe und Insert).
//
// Jede Suite bekommt eine eigene Filiale und damit einen eigenen Geschaeftstag: Alle
// Suiten unter `test/` teilen sich EINE SQLite, und das Shuffle-Gate mischt Tests.
describe('orders service — Vorgangsnummer je Geschaeftstag (dailySequenceNumber)', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const

  let locationId: string
  let userId: string

  const lineItem = () => ({
    _id: uuidv7(),
    externalId: uuidv7(),
    productGroupExternalId: uuidv7(),
    name: 'Vorgangsnummer-Testprodukt',
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

  const createOrder = async () => {
    const created = (await app.service('orders').create(
      {
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
      } as never,
      { ...internal, user: { _id: userId, tenantId, locationId } } as never,
    )) as Order

    onTestFinished(async () => {
      await app
        .service('orders')
        .remove(created._id, internal)
        .catch(() => undefined)
    })

    return created
  }

  beforeAll(async () => {
    await app.setup()

    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Vorgangsnummer',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id

    const user = (await app.service('users').create(
      {
        firstName: 'Vorgangs',
        lastName: 'Nummer',
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

  it('vergibt fuenf direkt hintereinander angelegten Bestellungen fuenf fortlaufende Nummern', async () => {
    const orders: Order[] = []
    for (let i = 0; i < 5; i++) orders.push(await createOrder())

    const numbers = orders.map(o => o.dailySequenceNumber)
    expect(new Set(numbers).size).toBe(5)
    expect(numbers).toEqual([0, 1, 2, 3, 4].map(i => numbers[0] + i))
    expect(new Set(orders.map(o => o.businessDayId)).size).toBe(1)
  })

  it('vergibt fuenf parallel angelegten Bestellungen fuenf verschiedene Nummern', async () => {
    // Erst den Geschaeftstag sicher anlegen lassen — sonst rotieren fuenf parallele
    // Creates womoeglich in verschiedene Tage, und der Test misst etwas anderes.
    const first = await createOrder()
    const parallel = await Promise.all(Array.from({ length: 5 }, () => createOrder()))

    const numbers = [first, ...parallel].map(o => o.dailySequenceNumber).sort((a, b) => a - b)
    expect(new Set(numbers).size).toBe(6)
    expect(numbers).toEqual([0, 1, 2, 3, 4, 5].map(i => first.dailySequenceNumber + i))
  })

  it('zaehlt nach einem Neustart (leerer Merker) ueber dem gespeicherten Maximum weiter', async () => {
    const before = await createOrder()
    resetDailySequenceMemory()
    const after = await createOrder()

    expect(after.dailySequenceNumber).toBe(before.dailySequenceNumber + 1)
  })
})
