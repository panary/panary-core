// Bootstrap-Push einer aus der Cloud gezogenen Filiale (panary/panary-core#748).
//
// Die Cloud-Filiale traegt kein `lastWorkdayOfWeek`/`businessType`; am Edge stehen
// die Spalten deshalb auf NULL. Der Push schickte `null` und die Cloud lehnte mit
// `/lastWorkdayOfWeek: must be integer` ab. Gegen die migrierte Test-SQLite: der
// Datensatz wird so gelesen wie im Bootstrap (find ueber die Hook-Kette).
import assert from 'assert'
import { uuidv7 } from 'uuidv7'

import { SyncSource } from '@panary/sync/domain'
import { app } from '../../src/app'
import { buildSyncOp } from '../../src/workers/cloud-bootstrap-runner.worker'

describe('cloud-bootstrap-runner — null an nicht nullbaren Feldern (#748)', () => {
  const tenantId = uuidv7()
  let locationId: string

  const knex = () => app.get('sqliteClient') as any

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Filiale #748',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    locationId = location._id
    // Wie nach dem Pull einer Cloud-Filiale ohne diese Felder.
    await knex()
      .table('locations')
      .where({ _id: locationId })
      .update({ lastWorkdayOfWeek: null, businessType: null, email: null })
  })

  afterAll(async () => {
    await knex().table('locations').where({ _id: locationId }).del()
    await app.teardown()
  })

  it('laesst null an Optional-Feldern ohne Null weg, behaelt null an nullbaren', async () => {
    const records = (await app.service('locations').find({
      provider: undefined,
      paginate: false,
      query: { tenantId },
    } as never)) as unknown as Record<string, unknown>[]
    const record = records.find(r => r._id === locationId)!
    assert.strictEqual(record.lastWorkdayOfWeek, null)

    const payload = buildSyncOp(record, 'locations', SyncSource.LIVE).payload as Record<string, unknown>

    assert.strictEqual('lastWorkdayOfWeek' in payload, false)
    assert.strictEqual('businessType' in payload, false)
    // email ist seit #738 nullbar — ein Leeren muss die Cloud erreichen.
    assert.strictEqual(payload.email, null)
    assert.strictEqual(payload.name, 'Filiale #748')
    assert.deepStrictEqual(payload.address, record.address)
  })
})
