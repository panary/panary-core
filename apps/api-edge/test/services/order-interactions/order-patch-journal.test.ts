import { uuidv7 } from 'uuidv7'
import { onTestFinished } from 'vitest'
import { app } from '../../../src/app'

// Integrationstest fuer den `after.patch`-Journalpfad (panary/panary-core#348,
// Schritt 2). Bis dahin erfasste `order-interactions` nur, was VOR dem
// Absenden passierte — die Interaktionen reisen im `create` mit. Ein Storno
// per Patch hinterliess KEIN Ereignis.
describe('order-interactions — Journal nach der Bestellannahme', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const

  let locationId: string
  let userId: string

  const lineItem = (amount = 1) => ({
    _id: uuidv7(),
    externalId: uuidv7(),
    productGroupExternalId: uuidv7(),
    name: 'Journal-Testprodukt',
    amount,
    price: 10,
    modifiers: [],
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: 19,
    taxOutside: 7,
    topic: 'kitchen',
    bundleNumber: null,
  })

  const createOrder = async (items = [lineItem()]) => {
    const created = (await app.service('orders').create(
      {
        tenantId,
        locationId,
        status: 'active',
        orderChannel: 'pos',
        dineLocation: 'dine-in',
        lineItems: items,
        isFinished: false,
        estimatedDuration: 0,
        remainingTime: 0,
        recordingDate: new Date().toISOString(),
      } as never,
      { ...internal, user: { _id: userId, tenantId, locationId } } as never,
    )) as { _id: string }

    onTestFinished(async () => {
      await app
        .service('orders')
        .remove(created._id, internal)
        .catch(() => undefined)
    })

    return created
  }

  const journalFor = async (orderId: string) =>
    (await app.service('order-interactions').find({
      ...internal,
      query: { orderId, type: 'order-cancel' },
    } as never)) as { total: number; data: Record<string, unknown>[] }

  beforeAll(async () => {
    await app.setup()

    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Journal',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id

    const user = (await app.service('users').create(
      { firstName: 'Journal', lastName: 'Bediener', role: 'tenant:staff', tenantId, activeLocationId: locationId } as never,
      internal,
    )) as { _id: string }
    userId = user._id
  })

  it('schreibt beim Storno ein Ereignis mit Bediener und Zeitpunkt', async () => {
    const order = await createOrder([lineItem(2), lineItem(3)])

    await app
      .service('orders')
      .patch(order._id, { status: 'aborted' } as never, {
        ...internal,
        user: { _id: userId, tenantId, locationId },
      } as never)

    const journal = await journalFor(order._id)

    expect(journal.total).toBe(1)
    expect(journal.data[0].userId).toBe(userId)
    expect(journal.data[0].eventAt).toBeTruthy()
    // `1`, nicht `true`: SQLite kennt keinen Boolean-Typ, Knex liefert 0/1 —
    // auch im `create`-Result, das der Sync-Outbox-Recorder als Payload
    // verwendet. Die Cloud faengt das mit `coerceBooleanFields('hadLineItems',
    // …)` ab (apps/api-cloud/src/services/order-interactions/order-interactions.ts);
    // ohne diese Coercion blieben order-cancel-Events dauerhaft `rejected`.
    expect(journal.data[0].hadLineItems).toBe(1)
    expect(journal.data[0].lineItemCountAtCancel).toBe(2)
    expect(journal.data[0].totalQuantityAtCancel).toBe(5)
  })

  it('schreibt KEIN Ereignis ohne Bediener — ein Journal ohne „wer" ist wertlos', async () => {
    // Interne Aufrufe (Worker, Seeds, Sync-Apply) tragen keinen `params.user`.
    // Dort gibt es keinen Bediener zu protokollieren; ein Eintrag mit erfundener
    // oder fehlender userId waere schlechter als keiner.
    const order = await createOrder()

    await app.service('orders').patch(order._id, { status: 'aborted' } as never, internal)

    const journal = await journalFor(order._id)

    expect(journal.total).toBe(0)
  })

  it('schreibt KEIN Ereignis bei einem Patch ohne Statuswechsel', async () => {
    const order = await createOrder()

    await app
      .service('orders')
      .patch(order._id, { remainingTime: 5 } as never, {
        ...internal,
        user: { _id: userId, tenantId, locationId },
      } as never)

    const journal = await journalFor(order._id)

    expect(journal.total).toBe(0)
  })

  it('laesst den Storno durchgehen, auch wenn das Journal scheitert', async () => {
    // Der Audit-Pfad nimmt Verlust bewusst in Kauf, statt den Geschaeftspfad zu
    // blockieren. Geprueft wird ueber einen Patch mit einer userId, die es nicht
    // gibt: Der Journal-Create scheitert an der Validierung, der Storno steht.
    const order = await createOrder()

    await app
      .service('orders')
      .patch(order._id, { status: 'aborted' } as never, {
        ...internal,
        user: { _id: 'kein-uuid', tenantId, locationId },
      } as never)

    const stored = (await app.service('orders').get(order._id, internal)) as { status: string }
    expect(stored.status).toBe('aborted')
  })
})
