// Filiale ohne E-Mail/Telefon/Website am Edge (panary/panary-core#738).
//
// Die Spalten sind nullable; SQLite liefert `null`. Der Bootstrap-Push brach an
// `/email: must be string` ab. Hier: ein Sync-Patch, der die Felder leert, geht durch
// und der gelesene Datensatz traegt `null` — ein Leeren springt nicht zurueck.
// Gegen die volle Hook-Kette und die migrierte Test-SQLite.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { app } from '../../../src/app'

describe('locations am Edge — null in email/phone/website (#738)', () => {
  const tenantId = uuidv7()
  let locationId: string

  const knex = () => app.get('sqliteClient') as any

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Filiale #738',
        tenantId,
        email: 'filiale@example.com',
        phone: '0123',
        website: 'https://example.com',
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    locationId = location._id
  })

  afterAll(async () => {
    await knex().table('locations').where({ _id: locationId }).del()
    await app.teardown()
  })

  it('ein Sync-Patch leert email, phone und website auf null', async () => {
    await app.service('locations').patch(
      locationId,
      { email: null, phone: null, website: null } as never,
      {
        provider: undefined,
        fromSync: true,
      } as never,
    )

    const row = await knex().table('locations').where({ _id: locationId }).first()
    assert.strictEqual(row.email, null)
    assert.strictEqual(row.phone, null)
    assert.strictEqual(row.website, null)

    const read = (await app.service('locations').get(locationId, { provider: undefined })) as Record<string, unknown>
    assert.strictEqual(read.email ?? null, null)
  })

  it('name lehnt null weiter ab', async () => {
    await assert.rejects(
      app.service('locations').patch(locationId, { name: null } as never, { provider: undefined } as never),
    )
  })
})
