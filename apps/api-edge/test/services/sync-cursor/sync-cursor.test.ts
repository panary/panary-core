import assert from 'assert'
import { type SyncCursor } from '@panary/sync/domain'
import { app } from '../../../src/app'

// Integrationstest fuer die interne Erst-Anlage des Sync-Cursors (Upsert im
// cloud-sync-scheduler.worker): laeuft gegen die echte Test-SQLite und die
// volle Hook-Kette. Verankert die Regression, dass der Create-Validator gegen
// das Data-Schema (ohne createdAt/updatedAt) validiert — gegen das volle
// Schema musste upsertCursor die Timestamps manuell vorstempeln
// (validateData laeuft vor resolveData).
describe('sync-cursor service — interne Erst-Anlage', () => {
  const id = 'cloud:products-test'

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    try {
      await app.service('sync-cursor').remove(id, { provider: undefined })
    } catch {
      // Datensatz existiert nicht — nichts aufzuraeumen
    }
  })

  it('legt den Cursor ohne Timestamps an (upsertCursor-Shape)', async () => {
    const created = (await app.service('sync-cursor').create(
      {
        _id: id,
        service: 'products-test',
        lastPullAt: new Date().toISOString(),
      },
      { provider: undefined },
    )) as SyncCursor

    assert.strictEqual(created._id, id)
    assert.ok(created.lastPullAt, 'lastPullAt muss uebernommen sein')
    assert.ok(created.createdAt, 'createdAt muss serverseitig gesetzt sein')
    assert.ok(created.updatedAt, 'updatedAt muss serverseitig gesetzt sein')
  })
})
