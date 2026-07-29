// Fokussierter Test fuer den gechunkten Bootstrap-Backfill
// (`queueBackfillOutbox`) gegen die ECHTE Test-SQLite und die volle
// Hook-Kette. Verankert drei Dinge, die kein In-Memory-Test abdecken kann:
//
//  1. Die Keyset-Query (`_id: { $gt }` + `createdAt: { $gte, $lte }` +
//     `$sort`/`$limit`) passiert den realen AJV-Query-Validator von
//     working-times — ein Query-Schema ohne diese Operatoren wuerde NUR
//     hier auffallen.
//  2. pageSize < Recordanzahl erzwingt mehrere Seiten — jede Entity landet
//     GENAU EINMAL als BACKFILL-Eintrag in der Outbox (keine Duplikate,
//     keine Luecken an Seitengrenzen).
//  3. Tenant-Scoping: Records fremder Tenants werden nicht eingereiht.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'

import { app } from '../../src/app'
import { queueBackfillOutbox } from '../../src/workers/cloud-bootstrap-runner.worker'

describe('cloud-bootstrap-runner — queueBackfillOutbox (chunked)', () => {
  const tenantId = uuidv7()
  const otherTenantId = uuidv7()
  const userId = uuidv7()
  const tenantRecordIds: string[] = []
  const otherTenantRecordIds: string[] = []

  const createWorkingTime = async (forTenantId: string): Promise<string> => {
    const created = (await app
      .service('working-times')
      .create(
        { tenantId: forTenantId, userId, checkinDate: new Date().toISOString() } as never,
        { provider: undefined } as never,
      )) as { _id: string }
    return created._id
  }

  beforeAll(async () => {
    await app.setup()
    for (let i = 0; i < 5; i++) tenantRecordIds.push(await createWorkingTime(tenantId))
    for (let i = 0; i < 2; i++) otherTenantRecordIds.push(await createWorkingTime(otherTenantId))
  })

  afterAll(async () => {
    const allRecordIds = [...tenantRecordIds, ...otherTenantRecordIds]
    for (const id of allRecordIds) {
      await app
        .service('working-times')
        .remove(id, { provider: undefined } as never)
        .catch(() => undefined)
    }
    // Outbox aufraeumen: sowohl die BACKFILL-Eintraege dieses Tests als auch
    // die LIVE-Eintraege, die der globale Recorder-Hook bei den Fixture-
    // Mutationen (create + remove) geschrieben hat.
    const entries = (await app.service('sync-outbox').find({
      provider: undefined,
      paginate: false,
      query: { entityId: { $in: allRecordIds } },
    } as never)) as Array<{ _id: string }>
    for (const entry of Array.isArray(entries) ? entries : []) {
      await app
        .service('sync-outbox')
        .remove(entry._id, { provider: undefined } as never)
        .catch(() => undefined)
    }
  })

  it('reiht jede Entity genau einmal ein — ueber mehrere Keyset-Seiten', async () => {
    // pageSize 2 bei 5 Records → 3 Seiten (2 + 2 + 1).
    const queued = await queueBackfillOutbox(app, 'working-times', tenantId, 2)
    assert.strictEqual(queued, 5)

    const entries = (await app.service('sync-outbox').find({
      provider: undefined,
      paginate: false,
      query: {
        syncSource: 'backfill',
        service: 'working-times',
        entityId: { $in: [...tenantRecordIds, ...otherTenantRecordIds] },
      },
    } as never)) as Array<{ entityId: string; op: string; status: string }>

    const list = Array.isArray(entries) ? entries : []
    assert.strictEqual(list.length, 5, JSON.stringify(list))
    // Keine Duplikate, keine Luecken an den Seitengrenzen.
    assert.deepStrictEqual(new Set(list.map(e => e.entityId)), new Set(tenantRecordIds))
    for (const entry of list) {
      assert.strictEqual(entry.op, 'create')
      assert.strictEqual(entry.status, 'pending')
    }
    // Tenant-Scoping: fremder Tenant bleibt draussen.
    for (const entry of list) {
      assert.ok(!otherTenantRecordIds.includes(entry.entityId))
    }
  })
})
