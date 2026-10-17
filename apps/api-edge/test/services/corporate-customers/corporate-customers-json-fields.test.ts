// Cloud-Patch an Firmenkunden mit `address` / `discountDetails` am Edge (panary/panary-core#735).
//
// `address`, `discountDetails` und `invoices` sind in SQLite TEXT-Spalten. knex stringifiziert plain
// Objects nur im Insert, nicht im Update — der Pull-Create ging deshalb durch, der Pull-Patch des
// vollen Cloud-Records (`workers/sync-apply.ts`) scheiterte an better-sqlite3 („can only bind numbers,
// strings, bigints, buffers, and null"). Beim Lesen kamen die Felder als String zurück.
//
// Bewusst gegen die volle Hook-Kette und die migrierte Test-SQLite (Vorlage: customers-json-fields).
import assert from 'assert'
import { onTestFinished } from 'vitest'
import { uuidv7 } from 'uuidv7'
import { app } from '../../../src/app'

interface StoredCorporateCustomer {
  _id: string
  name1: string
  address: unknown
  invoices: unknown
  discountDetails?: unknown
}

describe('corporate-customers am Edge — JSON-Felder address/invoices/discountDetails (#735)', () => {
  const tenantId = uuidv7()
  let locationId: string

  const knex = () => app.get('sqliteClient') as any

  const address = { address1: 'Firmenweg 1', city: 'Teststadt', zipCode: '12345', country: 'DE' }
  const discountDetails = { discountType: 'percent', discount: 5 }

  const record = (name1: string) => ({
    name1,
    email: null,
    address,
    invoices: [{ number: 'R-1' }],
    discountDetails,
  })

  /** Interner Create mit `fromSync` — exakt der Aufruf aus `sync-apply.ts`. */
  const pullCreate = async (data: Record<string, unknown>): Promise<StoredCorporateCustomer> => {
    const created = (await app
      .service('corporate-customers')
      .create(
        { _id: uuidv7(), tenantId, locationId, ...data } as never,
        { provider: undefined, fromSync: true } as never,
      )) as StoredCorporateCustomer
    onTestFinished(() => knex().table('corporate-customers').where({ _id: created._id }).del())
    return created
  }

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Filiale #735',
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

  it('Sync-Patch des vollen Cloud-Records mit address und discountDetails ändert name1', async () => {
    const created = await pullCreate(record('Vor dem Patch'))

    const patched = (await app.service('corporate-customers').patch(
      created._id,
      record('Umbenannt') as never,
      {
        provider: undefined,
        fromSync: true,
      } as never,
    )) as StoredCorporateCustomer

    assert.strictEqual(patched.name1, 'Umbenannt')
    const row = await knex().table('corporate-customers').where({ _id: created._id }).first()
    assert.strictEqual(row.name1, 'Umbenannt')
    assert.strictEqual(row.address, JSON.stringify(address))
  })

  it('get und find liefern address, invoices und discountDetails als Objekt/Array', async () => {
    const created = await pullCreate(record('Lesen'))

    const read = (await app
      .service('corporate-customers')
      .get(created._id, { provider: undefined })) as StoredCorporateCustomer
    assert.deepStrictEqual(read.address, address)
    assert.deepStrictEqual(read.invoices, [{ number: 'R-1' }])
    assert.deepStrictEqual(read.discountDetails, discountDetails)

    const found = (await app.service('corporate-customers').find({
      provider: undefined,
      query: { _id: created._id },
      paginate: false,
    } as never)) as unknown as StoredCorporateCustomer[]
    assert.deepStrictEqual(found[0]?.address, address)
    assert.deepStrictEqual(found[0]?.invoices, [{ number: 'R-1' }])
  })

  it('Patch ohne invoices lässt den gespeicherten Wert stehen', async () => {
    const bestand = await pullCreate(record('Bestand'))
    await app
      .service('corporate-customers')
      .patch(bestand._id, { name1: 'Nur Name' } as never, { provider: undefined, fromSync: true } as never)
    const row = await knex().table('corporate-customers').where({ _id: bestand._id }).first()
    assert.strictEqual(row.invoices, JSON.stringify([{ number: 'R-1' }]))
  })
})
