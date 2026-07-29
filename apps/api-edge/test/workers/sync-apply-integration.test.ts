// Integrationstest fuer `applyPulledRecords` gegen die ECHTE Test-SQLite und
// die volle Hook-Kette des users-Service. Verankert zwei Dinge, die der
// in-memory-Fokus-Test (sync-apply.test.ts) nicht abdecken kann:
//
//  1. Der GEBATCHTE Existenz-Check (`find { _id: { $in }, $select: ['_id'] }`)
//     passiert den realen AJV-Query-Validator (querySyntax) — ein Schema, das
//     `$in`/`$select` ablehnt, wuerde NUR hier auffallen.
//  2. Der fromSync-Upsert traegt durch die realen users-Resolver: Cloud-_id
//     bleibt erhalten (kein Re-Generate), geraetelokale Time-Clock-Felder
//     (stampingId) werden vor dem Apply gestrippt.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'

import { app } from '../../src/app'
import { applyPulledRecords } from '../../src/workers/sync-apply'

describe('sync-apply — applyPulledRecords Integration (users)', () => {
  const tenantId = uuidv7()
  const existingId = uuidv7()
  const newId = uuidv7()
  const now = new Date().toISOString()

  const cloudUserRecord = (id: string, lastName: string): Record<string, unknown> => ({
    _id: id,
    tenantId,
    firstName: 'Sync',
    lastName,
    role: 'tenant:staff',
    createdAt: now,
    updatedAt: now,
    // Geraetelokales Feld — muss vom users-Strip im Apply entfernt werden.
    stampingId: 'cloud-junk',
  })

  beforeAll(async () => {
    await app.setup()
    await app.service('users').create(
      {
        _id: existingId,
        firstName: 'Vorher',
        lastName: 'Bestand',
        role: 'tenant:staff',
        tenantId,
      } as never,
      { provider: undefined } as never,
    )
  })

  afterAll(async () => {
    for (const id of [existingId, newId]) {
      await app
        .service('users')
        .remove(id, { provider: undefined } as never)
        .catch(() => undefined)
    }
  })

  it('upserted eine Cloud-Seite (patch + create) durch die volle Hook-Kette', async () => {
    const result = await applyPulledRecords(app, 'users', [
      { _id: existingId, updatedAt: now, record: cloudUserRecord(existingId, 'Gepatcht') },
      { _id: newId, updatedAt: now, record: cloudUserRecord(newId, 'Neu') },
    ])

    assert.strictEqual(result.rejected, 0, JSON.stringify(result.details))
    assert.strictEqual(result.applied, 2)

    const patched = (await app.service('users').get(existingId, { provider: undefined } as never)) as Record<
      string,
      unknown
    >
    assert.strictEqual(patched.lastName, 'Gepatcht')
    // stampingId aus dem Cloud-Record darf NICHT ankommen (Edge-Runtime-Feld).
    assert.notStrictEqual(patched.stampingId, 'cloud-junk')

    const created = (await app.service('users').get(newId, { provider: undefined } as never)) as Record<string, unknown>
    // fromSync: Cloud-_id uebernommen, kein lokales Re-Generate.
    assert.strictEqual(created._id, newId)
    assert.strictEqual(created.lastName, 'Neu')
  })
})
