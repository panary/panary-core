import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { type SyncConflict, SyncConflictReason, SyncConflictStatus } from '@panary/sync/domain'
import { app } from '../../../src/app'

// Integrationstest fuer die interne Erst-Anlage von Sync-Konflikten: laeuft
// gegen die echte Test-SQLite und die volle Hook-Kette. Verankert die
// Regression, dass der Create-Validator gegen das Data-Schema (ohne
// createdAt/updatedAt) validiert — gegen das volle Schema mussten die
// Sync-Worker die Timestamps manuell vorstempeln (validateData laeuft vor
// resolveData), und der Bootstrap-Merge scheiterte mit `cloudRecordId: null`
// an der Optional-String-Validierung.
describe('sync-conflicts service — interne Erst-Anlage', () => {
  const tenantId = uuidv7()
  const createdIds: string[] = []

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    for (const id of createdIds) {
      try {
        await app.service('sync-conflicts').remove(id, { provider: undefined })
      } catch {
        // Datensatz existiert nicht — nichts aufzuraeumen
      }
    }
  })

  it('legt einen Push-Eskalations-Konflikt ohne Timestamps an (Worker-Shape)', async () => {
    const id = uuidv7()
    createdIds.push(id)

    const created = (await app.service('sync-conflicts').create(
      {
        _id: id,
        tenantId,
        locationId: null,
        service: 'products',
        edgeRecordId: uuidv7(),
        reason: SyncConflictReason.PUSH_REJECTED,
        edgePayload: { name: 'Edge-Variante' },
        cloudPayload: { name: 'Cloud-Variante' },
        status: SyncConflictStatus.OPEN,
      },
      { provider: undefined },
    )) as SyncConflict

    assert.strictEqual(created._id, id)
    assert.strictEqual(created.status, SyncConflictStatus.OPEN)
    assert.ok(created.createdAt, 'createdAt muss serverseitig gesetzt sein')
    assert.ok(created.updatedAt, 'updatedAt muss serverseitig gesetzt sein')
  })

  it('legt einen Bootstrap-Merge-Konflikt ohne cloudRecordId an (Bootstrap-Shape)', async () => {
    const id = uuidv7()
    createdIds.push(id)

    // Exakt die Datenform aus mergeByExternalId (cloud-bootstrap-runner):
    // kein cloudRecordId (Feld fehlt = „kein Cloud-Pendant"), cloudPayload null.
    const created = (await app.service('sync-conflicts').create(
      {
        _id: id,
        tenantId,
        locationId: null,
        service: 'products',
        edgeRecordId: uuidv7(),
        reason: SyncConflictReason.EXTERNAL_ID_MISSING,
        edgePayload: { name: 'Edge-Record ohne externalId' },
        cloudPayload: null,
        status: SyncConflictStatus.OPEN,
      },
      { provider: undefined },
    )) as SyncConflict

    assert.strictEqual(created._id, id)
    // SQLite liefert ungesetzte Spalten als null zurueck
    assert.ok(created.cloudRecordId == null, 'cloudRecordId bleibt ungesetzt')
    assert.ok(created.createdAt, 'createdAt muss serverseitig gesetzt sein')
    assert.ok(created.updatedAt, 'updatedAt muss serverseitig gesetzt sein')
  })
})
