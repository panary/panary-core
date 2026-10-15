// Kunden mit `invoices`-Array bzw. `discountDetails`-Objekt am Edge anlegen (panary/panary-core#624).
//
// Beide Felder sind in SQLite TEXT-Spalten. Ohne Serialisierung scheiterte der interne Create mit
// `invoices: []` an better-sqlite3 („can only bind numbers, strings, bigints, buffers, and null") —
// genau so legt der Sync-Pull (`workers/sync-apply.ts`) Cloud-Kunden an, und die Cloud-Admin-UI
// legt Privatkunden immer mit `invoices: []` an. Ein solcher Kunde kam nie auf dem Edge an.
//
// Bewusst gegen die volle Hook-Kette und die migrierte Test-SQLite: Die Lücke ist eine fehlende
// Registrierung am Service, eine Hook-Spec mit Mock-Knex sähe sie nicht.
import assert from 'assert'
import { onTestFinished } from 'vitest'
import { uuidv7 } from 'uuidv7'
import { app } from '../../../src/app'

interface StoredCustomer {
  _id: string
  invoices: unknown
  discountDetails?: unknown
}

describe('customers am Edge — JSON-Felder invoices/discountDetails (#624)', () => {
  const tenantId = uuidv7()
  let locationId: string

  const knex = () => app.get('sqliteClient') as any

  const customerData = (name1: string) => ({
    name1,
    name2: '',
    address1: 'Teststr. 1',
    address2: '',
    city: 'Teststadt',
    zipCode: '12345',
    phone: '0123',
    email: null,
    invoices: [],
  })

  /** Interner Create mit `fromSync` — exakt der Aufruf aus `sync-apply.ts`. */
  const pullCreate = async (data: Record<string, unknown>): Promise<StoredCustomer> => {
    const created = (await app
      .service('customers')
      .create({ _id: uuidv7(), tenantId, locationId, ...data } as never, {
        provider: undefined,
        fromSync: true,
      } as never)) as StoredCustomer
    onTestFinished(() => knex().table('customers').where({ _id: created._id }).del())
    return created
  }

  const storedRow = async (id: string): Promise<StoredCustomer | undefined> =>
    (await knex().table('customers').where({ _id: id }).first()) as StoredCustomer | undefined

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Filiale #624',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    locationId = location._id
  })

  afterAll(async () => {
    await app.teardown()
  })

  it('legt einen Kunden mit invoices: [] an und liefert invoices als Array aus', async () => {
    const created = await pullCreate(customerData('Aus der Cloud'))

    assert.deepStrictEqual(created.invoices, [])
    assert.strictEqual((await storedRow(created._id))?.invoices, '[]')

    const read = (await app.service('customers').get(created._id, { provider: undefined })) as StoredCustomer
    assert.deepStrictEqual(read.invoices, [])
  })

  it('serialisiert discountDetails (Objekt) und liest es als Objekt zurück', async () => {
    const discountDetails = { discountType: 'PERCENT', discount: 10 }
    const created = await pullCreate({ ...customerData('Mit Rabatt'), discountDetails })

    assert.strictEqual((await storedRow(created._id))?.discountDetails, JSON.stringify(discountDetails))
    const read = (await app.service('customers').get(created._id, { provider: undefined })) as StoredCustomer
    assert.deepStrictEqual(read.discountDetails, discountDetails)
  })

  it('patcht invoices mit einem Array (Sync-Patch des vollen Cloud-Records)', async () => {
    const created = await pullCreate(customerData('Vor dem Patch'))
    const invoices = [{ number: 'R-1', total: 1290 }]

    const patched = (await app
      .service('customers')
      .patch(created._id, { invoices } as never, { provider: undefined, fromSync: true } as never)) as StoredCustomer

    assert.deepStrictEqual(patched.invoices, invoices)
    assert.strictEqual((await storedRow(created._id))?.invoices, JSON.stringify(invoices))

    const found = (await app.service('customers').find({
      provider: undefined,
      query: { _id: created._id },
      paginate: false,
    } as never)) as unknown as StoredCustomer[]
    assert.deepStrictEqual(found[0]?.invoices, invoices)
  })

  it('lässt beim Patch ohne invoices den gespeicherten Wert stehen', async () => {
    const created = await pullCreate({ ...customerData('Bestand'), invoices: [{ number: 'R-2' }] })

    await app.service('customers').patch(created._id, { name1: 'Umbenannt' } as never, { provider: undefined })

    assert.strictEqual((await storedRow(created._id))?.invoices, JSON.stringify([{ number: 'R-2' }]))
  })
})
