import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { onTestFinished } from 'vitest'
import { computeOrderTax, Order } from '@panary/orders/domain'
import { app } from '../../../src/app'

// Integrationstest fuer den fiskalischen taxSnapshot am Order-PATCH
// (KassenSichV-relevanter Pfad): laeuft gegen die echte Test-SQLite und die
// VOLLE Hook-Kette des orders-Service. Verankert damit die REGISTRIERUNG von
// `calculateTaxDetailsOnPatch` in before.patch — die Hook-Logik selbst ist
// bereits per Unit-Spec (calculate-tax-details.spec.ts) gelockt, aber ein
// nicht registrierter Hook faellt nur hier auf.
//
// **Jeder Test legt seine eigene Order an** (Code-Style §10.1, #301): Vorher lag
// EINE Order im `beforeAll`, die alle Tests nacheinander patchten — der
// Snapshot war damit eine Funktion der Testreihenfolge. Unter
// `--sequence.shuffle` (mischt auch die Tests INNERHALB einer Datei) rot,
// gemessen 2026-09-13 unter den Seeds 11/12/17/20: `2000 !== 4000`, weil der
// 50%-Rabatt-Test lief und der ihn zuruecknehmende Test noch nicht.
//
// Filiale und User bleiben im `beforeAll` — sie sind Aufbau, den kein Test
// veraendert; geteilt ist hier die Ressource, nicht der Zustand. Dieselbe
// Aufteilung wie in `test/services/pre-orders/opening-hours-location-scope.test.ts`.
describe('orders service — taxSnapshot bei preisrelevanten Patches', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const

  let locationId: string
  let userId: string

  // 2 × 20,00€ @19% (dine-in) → Brutto 40,00€.
  const lineItem = () => ({
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
  })

  const manualHalfOffDiscount = () => [
    {
      _id: uuidv7(),
      discountId: null,
      name: 'Integrationstest-Rabatt',
      method: 'manual',
      target: 'order',
      valueType: 'percent',
      valuePercent: 50,
      valueCents: 0,
      computedAmountCents: 0,
      appliedAt: new Date().toISOString(),
    },
  ]

  /** Legt eine unrabattierte Order (4000 Cents brutto) an und raeumt sie am Ende DIESES Tests ab. */
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
      // params.user aktiviert das multiTenancy-WRITE-Stamping auch intern —
      // tenantId/locationId muessen daher am User-Objekt haengen (Memory-Regel:
      // Stamp kommt aus params.user, nie aus dem Quell-Datensatz).
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

  // `device:pos-client` traegt `orders: MANAGE` — die Rolle, unter der der POS
  // patcht. tenantId/locationId am User, sonst filtert `multiTenancy` die Order weg
  // und der Test misst einen 404 statt der Regel.
  const posParams = () =>
    ({
      provider: 'rest',
      authenticated: true,
      user: { _id: userId, role: 'device:pos-client', tenantId, locationId, activeLocationId: locationId },
    }) as never

  beforeAll(async () => {
    await app.setup()

    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale taxSnapshot',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
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

  it('create setzt den Server-Snapshot (Basis fuer die Patch-Faelle)', async () => {
    const createdOrder = await createOrder()

    assert.ok(createdOrder.taxSnapshot, 'create muss einen taxSnapshot setzen')
    assert.strictEqual(Math.round(createdOrder.taxSnapshot!.brutto * 100), 4000)
  })

  it('patch mit appliedDiscounts → taxSnapshot wird serverseitig neu berechnet (cent-korrekt gegen computeOrderTax)', async () => {
    const createdOrder = await createOrder()
    const appliedDiscounts = manualHalfOffDiscount()

    const patched = (await app
      .service('orders')
      .patch(createdOrder._id, { appliedDiscounts } as never, internal)) as Order

    // Referenz: kanonische Engine auf dem Zielzustand (Order + neuer Rabatt).
    // Eigene Kopie, weil die Engine `computedAmountCents` in die Eintraege
    // zurueckschreibt — geteilte Objekte wuerden den Vergleich verfaelschen.
    const expected = computeOrderTax({
      ...createdOrder,
      appliedDiscounts: appliedDiscounts.map(d => ({ ...d })),
    } as Order)
    assert.deepStrictEqual(patched.taxSnapshot, expected, 'Patch-Result muss den neu berechneten Snapshot tragen')

    // 4000 Cents − 50% = 2000 Cents Brutto; Netto round(2000·100/119) = 1681.
    assert.strictEqual(Math.round(patched.taxSnapshot!.brutto * 100), 2000)
    assert.strictEqual(Math.round(patched.taxSnapshot!.netto * 100), 1681)
    assert.strictEqual(Math.round(patched.taxSnapshot!.taxes[0].tax * 100), 319)

    // Persistenz-Check: auch der gespeicherte Datensatz traegt den neuen Snapshot.
    const stored = (await app.service('orders').get(createdOrder._id, internal)) as Order
    assert.deepStrictEqual(stored.taxSnapshot, expected)
  })

  it('patch, der alle Rabatte entfernt (appliedDiscounts: []) → Snapshot zurueck auf den vollen Preis', async () => {
    const createdOrder = await createOrder()

    // Der Rabatt gehoert seit #301 in DIESEN Test: Frueher kam er aus dem Test
    // davor. Ohne ihn misst der Fall nichts — auf einer nie rabattierten Order
    // waere „zurueck auf den vollen Preis" trivial erfuellt.
    const discounted = (await app
      .service('orders')
      .patch(createdOrder._id, { appliedDiscounts: manualHalfOffDiscount() } as never, internal)) as Order
    assert.strictEqual(Math.round(discounted.taxSnapshot!.brutto * 100), 2000, 'Vorbedingung: Order ist rabattiert')

    const patched = (await app
      .service('orders')
      .patch(createdOrder._id, { appliedDiscounts: [] } as never, internal)) as Order

    assert.strictEqual(Math.round(patched.taxSnapshot!.brutto * 100), 4000)
    assert.strictEqual(Math.round(patched.taxSnapshot!.netto * 100), 3361)
  })

  it('preis-irrelevanter Patch laesst den Snapshot unveraendert', async () => {
    const createdOrder = await createOrder()
    const before = (await app.service('orders').get(createdOrder._id, internal)) as Order

    const patched = (await app.service('orders').patch(createdOrder._id, { table: 'T5' } as never, internal)) as Order

    assert.deepStrictEqual(patched.taxSnapshot, before.taxSnapshot)
  })

  // Verankert die REGISTRIERUNG von `rejectLegacyDiscount` in before.create/patch
  // (ADR 0030). Die Regel selbst ist per Unit-Spec gelockt; ein nicht registrierter
  // Hook faellt nur hier auf. Seit das Feld auch aus `orderSchema` entfernt ist, wuerde
  // `validateData` es ebenfalls abweisen — der Hook liefert aber die sprechende
  // Meldung und laeuft, bevor Sequenznummer und TSE-Start Nebenwirkungen erzeugen.
  describe('Legacy-Rabattfeld ist abgeschafft', () => {
    const legacyDiscount = { discountType: 'percent', discount: 50 } as const

    it('externer Patch mit discount → 400', async () => {
      const createdOrder = await createOrder()

      await assert.rejects(
        () => app.service('orders').patch(createdOrder._id, { discount: legacyDiscount } as never, posParams()),
        (err: { code?: number }) => err.code === 400,
      )
    })

    it('auch discount: null wird abgelehnt — das Feld existiert nicht mehr', async () => {
      const createdOrder = await createOrder()

      await assert.rejects(
        () => app.service('orders').patch(createdOrder._id, { discount: null } as never, posParams()),
        (err: { code?: number }) => err.code === 400,
      )
    })

    it('der abgelehnte Patch laesst den Snapshot der Order unveraendert', async () => {
      // Die Ablehnung wird hier selbst ausgeloest: Frueher verliess sich dieser Test
      // darauf, dass die beiden Tests davor gelaufen waren — und mass den Snapshot
      // einer Order, deren Zustand aus vier fremden Patches stammte.
      const createdOrder = await createOrder()

      await assert.rejects(
        () => app.service('orders').patch(createdOrder._id, { discount: legacyDiscount } as never, posParams()),
        (err: { code?: number }) => err.code === 400,
      )

      const stored = (await app.service('orders').get(createdOrder._id, internal)) as Order
      assert.strictEqual(Math.round(stored.taxSnapshot!.brutto * 100), 4000)
    })
  })
})
