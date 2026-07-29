import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { computeOrderTax, Order } from '@panary/orders/domain'
import { app } from '../../../src/app'

// Integrationstest fuer den fiskalischen taxSnapshot am Order-PATCH
// (KassenSichV-relevanter Pfad): laeuft gegen die echte Test-SQLite und die
// VOLLE Hook-Kette des orders-Service. Verankert damit die REGISTRIERUNG von
// `calculateTaxDetailsOnPatch` in before.patch — die Hook-Logik selbst ist
// bereits per Unit-Spec (calculate-tax-details.spec.ts) gelockt, aber ein
// nicht registrierter Hook faellt nur hier auf.
describe('orders service — taxSnapshot bei preisrelevanten Patches', () => {
  const tenantId = uuidv7()

  let locationId: string
  let userId: string
  let orderId: string
  let createdOrder: Order

  // 2 × 20,00€ @19% (dine-in) → Brutto 40,00€.
  const lineItem = {
    _id: uuidv7(),
    externalId: uuidv7(),
    productGroupExternalId: uuidv7(),
    name: 'Integrationstest-Produkt',
    amount: 2,
    price: 20,
    modifiers: [],
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: 19,
    taxOutside: 7,
    topic: 'kitchen',
    bundleNumber: null,
  }

  beforeAll(async () => {
    await app.setup()

    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale taxSnapshot',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    locationId = location._id

    // `restrictOrderToBusinessDay` loest die Location ueber den User auf —
    // `activeLocationId` explizit setzen, damit der Test nicht vom
    // Standalone-Fallback (erste Location der DB) abhaengt.
    const user = (await app.service('users').create(
      {
        firstName: 'Tax',
        lastName: 'Tester',
        role: 'tenant:staff',
        tenantId,
        activeLocationId: locationId,
      } as never,
      { provider: undefined },
    )) as { _id: string }
    userId = user._id

    createdOrder = (await app.service('orders').create(
      {
        tenantId,
        locationId,
        status: 'active',
        orderChannel: 'pos',
        dineLocation: 'dine-in',
        lineItems: [lineItem],
        isFinished: false,
        estimatedDuration: 0,
        remainingTime: 0,
        recordingDate: new Date().toISOString(),
      } as never,
      // params.user aktiviert das multiTenancy-WRITE-Stamping auch intern —
      // tenantId/locationId muessen daher am User-Objekt haengen (Memory-Regel:
      // Stamp kommt aus params.user, nie aus dem Quell-Datensatz).
      { provider: undefined, user: { _id: userId, tenantId, locationId } as never },
    )) as Order
    orderId = createdOrder._id
  })

  afterAll(async () => {
    if (orderId) await app.service('orders').remove(orderId, { provider: undefined })
    if (locationId) {
      const days = (await app.service('businessdays').find({
        provider: undefined,
        paginate: false,
        query: { locationId },
      })) as Array<{ _id: string }>
      for (const day of days) {
        await app.service('businessdays').remove(day._id, { provider: undefined, isEmergencyOverride: true } as never)
      }
      await app.service('locations').remove(locationId, { provider: undefined })
    }
    if (userId) await app.service('users').remove(userId, { provider: undefined })
    await app.teardown()
  })

  it('create setzt den Server-Snapshot (Basis fuer die Patch-Faelle)', () => {
    assert.ok(createdOrder.taxSnapshot, 'create muss einen taxSnapshot setzen')
    assert.strictEqual(Math.round(createdOrder.taxSnapshot!.brutto * 100), 4000)
  })

  it('patch mit discount → taxSnapshot wird serverseitig neu berechnet (cent-korrekt gegen computeOrderTax)', async () => {
    const discount = { discountType: 'percent', discount: 50 } as const

    const patched = (await app
      .service('orders')
      .patch(orderId, { discount } as never, { provider: undefined })) as Order

    // Referenz: kanonische Engine auf dem Zielzustand (Order + neuer Rabatt).
    const expected = computeOrderTax({ ...createdOrder, discount } as Order)
    assert.deepStrictEqual(patched.taxSnapshot, expected, 'Patch-Result muss den neu berechneten Snapshot tragen')

    // 4000 Cents − 50% = 2000 Cents Brutto; Netto round(2000·100/119) = 1681.
    assert.strictEqual(Math.round(patched.taxSnapshot!.brutto * 100), 2000)
    assert.strictEqual(Math.round(patched.taxSnapshot!.netto * 100), 1681)
    assert.strictEqual(Math.round(patched.taxSnapshot!.taxes[0].tax * 100), 319)

    // Persistenz-Check: auch der gespeicherte Datensatz traegt den neuen Snapshot.
    const stored = (await app.service('orders').get(orderId, { provider: undefined })) as Order
    assert.deepStrictEqual(stored.taxSnapshot, expected)
  })

  it('patch, der den discount entfernt (null) → Snapshot zurueck auf den vollen Preis', async () => {
    const patched = (await app
      .service('orders')
      .patch(orderId, { discount: null } as never, { provider: undefined })) as Order

    assert.strictEqual(Math.round(patched.taxSnapshot!.brutto * 100), 4000)
    assert.strictEqual(Math.round(patched.taxSnapshot!.netto * 100), 3361)
  })

  it('preis-irrelevanter Patch laesst den Snapshot unveraendert', async () => {
    const before = (await app.service('orders').get(orderId, { provider: undefined })) as Order

    const patched = (await app
      .service('orders')
      .patch(orderId, { table: 'T5' } as never, { provider: undefined })) as Order

    assert.deepStrictEqual(patched.taxSnapshot, before.taxSnapshot)
  })
})
