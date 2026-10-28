import { uuidv7 } from 'uuidv7'
import { onTestFinished } from 'vitest'
import { isSyntheticSettlementScope, Order } from '@panary/orders/domain'
import { app } from '../../../src/app'

// Integrationstest fuer den Abrechnungskreis (DSFinV-K `ABRECHNUNGSKREIS`,
// #345): laeuft gegen die echte Test-SQLite und die VOLLE Hook-Kette des
// orders-Service. Er verankert drei Dinge, die eine Unit-Spec nicht sehen kann:
//
//   1. die REGISTRIERUNG von `assignSettlementScope()` in `before.create` —
//      und ihre Position NACH `restrictOrderToBusinessDay`/
//      `assignDailySequenceNumber`, aus denen der synthetische Wert entsteht,
//   2. dass `settlementScope` in `orderQueryProperties` steht: fehlt es dort,
//      antwortet `find({ settlementScope })` mit 400 statt 200
//      (`orderQuerySchema` traegt `additionalProperties: false`),
//   3. dass der Patch-Resolver das Feld STILL strippt. Der Nachweis ist der
//      unveraenderte Wert beim anschliessenden `get` — NICHT der Statuscode:
//      der Client bekommt HTTP 200, und es passiert nichts.
//
// **Jeder Test legt seine eigene Order an** (Code-Style §10.1): Alle Suiten
// unter `test/` teilen sich EINE SQLite, und das Shuffle-Gate mischt auch die
// Tests innerhalb einer Datei.
describe('orders service — Abrechnungskreis (settlementScope)', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const

  let locationId: string
  let userId: string

  // Eigener Tisch je Test: Der Besuchszaehler zaehlt alle Bestellungen des
  // Tisches am Geschaeftstag, und die SQLite teilen sich alle Suiten (§10.2).
  const uniqueTable = () => `T-${uuidv7().slice(-8)}`

  const lineItem = () => ({
    _id: uuidv7(),
    externalId: uuidv7(),
    productGroupExternalId: uuidv7(),
    name: 'Abrechnungskreis-Testprodukt',
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

  /** Legt eine Order an und raeumt sie am Ende DIESES Tests ab. */
  const createOrder = async (extra: Record<string, unknown> = {}) => {
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
        ...extra,
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

  // Bewusst OHNE `as never` (anders als in `orders.test.ts`): Der `find`-Test
  // spreadet die Params, und aus `never` laesst sich nicht spreaden (TS2698).
  // Der Cast sitzt stattdessen an der Aufrufstelle.
  const posParams = () => ({
    provider: 'rest',
    authenticated: true,
    user: { _id: userId, role: 'device:pos-client', tenantId, locationId, activeLocationId: locationId },
  })

  beforeAll(async () => {
    await app.setup()

    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Abrechnungskreis',
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
        firstName: 'Abrechnungs',
        lastName: 'Kreis',
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

  it('uebernimmt den Tisch mit Besuch als Abrechnungskreis', async () => {
    const table = uniqueTable()
    const order = await createOrder({ table })
    expect(order.settlementScope).toBe(`${table}#1`)
  })

  it('gibt zwei Bestellungen desselben Tisches denselben Abrechnungskreis', async () => {
    const table = uniqueTable()
    const first = await createOrder({ table })
    const second = await createOrder({ table })

    expect(second.settlementScope).toBe(first.settlementScope)
    // Die Vorgangsnummern unterscheiden sich — die Klammer ist der Tisch, nicht der Vorgang.
    expect(second.dailySequenceNumber).not.toBe(first.dailySequenceNumber)
  })

  it('setzt ohne Tisch einen erkennbar synthetischen Wert — nie leer, nie null', async () => {
    const order = await createOrder()

    expect(typeof order.settlementScope).toBe('string')
    expect(order.settlementScope.length).toBeGreaterThan(0)
    expect(isSyntheticSettlementScope(order.settlementScope)).toBe(true)
  })

  it('gibt zwei Bestellungen ohne Tisch je einen eigenen Abrechnungskreis', async () => {
    const first = await createOrder()
    const second = await createOrder()

    expect(second.settlementScope).not.toBe(first.settlementScope)
  })

  it('findet ueber settlementScope — 200 mit beiden Bestellungen, nicht 400', async () => {
    const table = uniqueTable()
    await createOrder({ table })
    await createOrder({ table })

    // Ohne `settlementScope` in `orderQueryProperties` wirft dieser Aufruf
    // `BadRequest: validation failed` — das ist der eigentliche Gegenstand.
    const result = (await app.service('orders').find({
      ...posParams(),
      query: { settlementScope: `${table}#1` },
    } as never)) as unknown as { total: number; data: Order[] }

    expect(result.total).toBe(2)
    expect(result.data.every(o => o.settlementScope === `${table}#1`)).toBe(true)
  })

  it('laesst den Abrechnungskreis beim Patch unveraendert — still, mit HTTP 200', async () => {
    const table = uniqueTable()
    const order = await createOrder({ table })

    // Kein `rejects.toThrow()`: Der Resolver strippt das Feld, er lehnt nicht ab.
    const patched = (await app
      .service('orders')
      .patch(order._id, { settlementScope: 'gekapert' } as never, posParams() as never)) as Order

    expect(patched.settlementScope).toBe(`${table}#1`)

    // Der eigentliche Nachweis — nachlesen statt dem Patch-Ergebnis glauben.
    const reread = (await app.service('orders').get(order._id, internal)) as Order
    expect(reread.settlementScope).toBe(`${table}#1`)
  })

  it('haelt den Abrechnungskreis auch fest, wenn derselbe Patch den Tisch aendert', async () => {
    const table = uniqueTable()
    const order = await createOrder({ table })

    await app.service('orders').patch(order._id, { table: '10', settlementScope: '10' } as never, posParams() as never)

    const reread = (await app.service('orders').get(order._id, internal)) as Order
    expect(reread.table).toBe('10')
    // Eine Tischverlegung verschiebt den Abrechnungskreis NICHT — genau das
    // macht die Verlegung fuer einen Pruefer nachvollziehbar (DSFinV-K Tz. 3.1.2.2).
    expect(reread.settlementScope).toBe(`${table}#1`)
  })

  // --- Besuchszaehler und Riegel (ADR 0063 Nr. 2 und 4, #1139) ---

  /** Schliesst eine Bestellung ab — der Riegel liest genau diesen Status. */
  const complete = (orderId: string) =>
    app.service('orders').patch(orderId, { status: 'completed' } as never, internal as never)

  it('gibt zwei Gaestegruppen nacheinander am selben Tisch verschiedene Kreise', async () => {
    const table = uniqueTable()
    const first = await createOrder({ table })
    await complete(first._id)

    const second = await createOrder({ table })

    expect(first.settlementScope).toBe(`${table}#1`)
    expect(second.settlementScope).toBe(`${table}#2`)
  })

  it('legt eine Nachbestellung waehrend des offenen Besuchs in denselben Kreis', async () => {
    const table = uniqueTable()
    const first = await createOrder({ table })
    const followUp = await createOrder({ table, settlementScope: first.settlementScope })

    expect(followUp.settlementScope).toBe(`${table}#1`)
  })

  it('ordnet eine verspaetete Bestellung fuer einen geschlossenen Besuch dem naechsten zu und schreibt das Journal', async () => {
    const table = uniqueTable()
    const first = await createOrder({ table })
    await complete(first._id)

    const late = await createOrder({
      table,
      settlementScope: `${table}#1`,
      creationContext: { createdBy: userId },
    })

    expect(late.settlementScope).toBe(`${table}#2`)

    const journal = (await app.service('order-interactions').find({
      ...internal,
      paginate: false,
      query: { orderId: late._id },
    } as never)) as unknown as Array<{ _id: string; type: string; userId: string }>
    onTestFinished(async () => {
      for (const entry of journal) {
        await app
          .service('order-interactions')
          .remove(entry._id, internal)
          .catch(() => undefined)
      }
    })

    expect(journal.map(entry => [entry.type, entry.userId])).toEqual([['settlement-scope-reassigned', userId]])
  })

  it('uebernimmt den Kreis eines alten Clients (ohne Besuch) unveraendert', async () => {
    const table = uniqueTable()
    const order = await createOrder({ table, settlementScope: table })
    expect(order.settlementScope).toBe(table)
  })

  it('faellt synthetisch zurueck, wenn `<Label>#<n>` die 50 Zeichen sprengt', async () => {
    const table = `${uniqueTable()}${'x'.repeat(49)}`.slice(0, 49)
    const order = await createOrder({ table })

    expect(order.table).toBe(table)
    expect(isSyntheticSettlementScope(order.settlementScope)).toBe(true)
  })
})
