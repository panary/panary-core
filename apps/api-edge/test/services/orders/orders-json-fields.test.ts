import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { AppliedDiscount, Order } from '@panary/orders/domain'
import { app } from '../../../src/app'

// Integrationstest gegen die echte Test-SQLite + volle Hook-Kette des orders-Service.
//
// Verankert, dass die JSON-Array-Felder `appliedDiscounts` und `stockMovementIds`
// serialisiert (before → stringifyJsonFields) und wieder geparst (after →
// parseJsonFields) werden — d.h. dass beide in ORDER_JSON_FIELDS (orders.ts)
// gelistet sind. Ohne die Registrierung bindet better-sqlite3 ein JS-Array an
// die TEXT-Spalte und wirft beim `create` ("can only bind numbers, strings,
// bigints, buffers, and null"); ein nicht registriertes Feld faellt nur hier auf.
//
// Beide Felder werden auf dem Edge tatsaechlich geschrieben:
//   - appliedDiscounts: injiziert der before.create-Hook `applyAutomaticDiscounts`
//     (bzw. der POS-Dialog sendet manuelle Rabatte direkt im Payload).
//   - stockMovementIds: schreibt der Cloud-Hook; der Sync-Pull-Apply persistiert
//     die gepullte Order via `service.create/patch` in die Edge-SQLite.
describe('orders service — JSON-Array-Felder (appliedDiscounts/stockMovementIds) Roundtrip', () => {
  const tenantId = uuidv7()

  let locationId: string
  let userId: string
  let orderId: string
  let createdOrder: Order

  const lineItem = {
    _id: uuidv7(),
    externalId: uuidv7(),
    productGroupExternalId: uuidv7(),
    name: 'JSON-Roundtrip-Produkt',
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

  // Manueller Order-Rabatt (nicht-leeres appliedDiscounts) — deckt den Schreibpfad
  // ab, den `applyAutomaticDiscounts`/der POS-Dialog erzeugen.
  const appliedDiscount: AppliedDiscount = {
    _id: uuidv7(),
    discountId: uuidv7(),
    name: 'JSON-Roundtrip-Rabatt',
    method: 'manual',
    target: 'order',
    valueType: 'percent',
    valuePercent: 10,
    valueCents: 0,
    computedAmountCents: 0,
    appliedAt: new Date().toISOString(),
  }

  // Simuliert die vom Cloud-Hook gesetzten SALES_OUT-Movement-IDs, wie sie der
  // Sync-Pull-Apply in die Order schreibt.
  const stockMovementIds = [uuidv7(), uuidv7()]

  beforeAll(async () => {
    await app.setup()

    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale JSON-Roundtrip',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    locationId = location._id

    const user = (await app.service('users').create(
      {
        firstName: 'Json',
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
        appliedDiscounts: [appliedDiscount],
        stockMovementIds,
        isFinished: false,
        estimatedDuration: 0,
        remainingTime: 0,
        recordingDate: new Date().toISOString(),
      } as never,
      // Stamp kommt aus params.user (multiTenancy-WRITE) — nie aus dem Datensatz.
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

  it('create liefert appliedDiscounts als Array zurueck (kein roher JSON-String)', () => {
    const applied = createdOrder.appliedDiscounts as AppliedDiscount[]
    assert.ok(Array.isArray(applied), 'appliedDiscounts muss ein Array sein')
    assert.strictEqual(applied.length, 1)
    assert.strictEqual(applied[0]._id, appliedDiscount._id)
    assert.strictEqual(applied[0].name, appliedDiscount.name)
  })

  it('get persistiert appliedDiscounts roundtrip-sicher (SQLite TEXT → geparst)', async () => {
    const stored = (await app.service('orders').get(orderId, { provider: undefined })) as Order
    const applied = stored.appliedDiscounts as AppliedDiscount[]
    assert.ok(Array.isArray(applied), 'appliedDiscounts muss nach get ein Array sein')
    assert.strictEqual(applied.length, 1)
    assert.strictEqual(applied[0]._id, appliedDiscount._id)
  })

  it('get persistiert stockMovementIds roundtrip-sicher (SQLite TEXT → geparst)', async () => {
    const stored = (await app.service('orders').get(orderId, { provider: undefined })) as Order
    assert.ok(Array.isArray(stored.stockMovementIds), 'stockMovementIds muss ein Array sein')
    assert.deepStrictEqual(stored.stockMovementIds, stockMovementIds)
  })
})
