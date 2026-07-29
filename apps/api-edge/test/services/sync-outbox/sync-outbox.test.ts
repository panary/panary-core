// For more information about this file see https://dove.feathersjs.com/guides/cli/service.test.html
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import {
  type ReEnqueueOutboxArgs,
  SyncConflictReason,
  SyncConflictStatus,
  SyncOp,
  type SyncOutboxEntry,
  SyncOutboxStatus,
  SyncSource,
} from '@panary/sync/domain'
import { app } from '../../../src/app'

describe('sync-outbox service', () => {
  it('registered the service', () => {
    const service = app.service('sync-outbox')

    assert.ok(service, 'Registered the service')
  })

  it('exposes the reEnqueue custom method', () => {
    const service = app.service('sync-outbox') as unknown as { reEnqueue?: unknown }

    assert.strictEqual(
      typeof service.reEnqueue,
      'function',
      'reEnqueue custom method should be bound on the service proxy',
    )
  })
})

// Business-Logik-Tests fuer die reEnqueue-Custom-Method (Operator-Aktion
// „Mit aktuellem Stand erneut hochladen" im Sync-Status-UI). Laeuft gegen die
// echte Test-SQLite und die volle Hook-Kette; `sync-conflicts` dient als
// technischer Ziel-Service fuer `service.get(entityId)` — der Test prueft die
// Outbox-Mechanik (Guard, Op-Preservation, Payload-Refresh, Row-Cleanup) und
// nicht die Semantik einer bestimmten Domain.
describe('sync-outbox service — reEnqueue', () => {
  type ReEnqueueService = {
    reEnqueue: (data: ReEnqueueOutboxArgs) => Promise<SyncOutboxEntry>
  }

  const tenantId = uuidv7()
  const outboxCleanup: string[] = []
  const targetCleanup: string[] = []

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    for (const id of outboxCleanup) {
      try {
        await app.service('sync-outbox').remove(id, { provider: undefined })
      } catch {
        // Datensatz existiert nicht — nichts aufzuraeumen (reEnqueue hat ihn evtl. schon entfernt)
      }
    }
    for (const id of targetCleanup) {
      try {
        await app.service('sync-conflicts').remove(id, { provider: undefined })
      } catch {
        // ignoriere
      }
    }
    await app.teardown()
  })

  // Helper: legt einen Ziel-Record (sync-conflicts) an, damit `service.get`
  // aus reEnqueueOutboxEntry etwas zurueckliefert. `targetExists=false`
  // uebergibt eine unbekannte entityId → simuliert den „Edge-Record wurde
  // zwischenzeitlich geloescht"-Pfad.
  async function makeRejectedOutboxEntry(
    op: SyncOp,
    targetExists = true,
  ): Promise<{ outboxId: string; entityId: string; freshName?: string }> {
    let entityId: string
    let freshName: string | undefined
    if (targetExists) {
      freshName = `frisch-${uuidv7()}`
      const target = (await app.service('sync-conflicts').create(
        {
          _id: uuidv7(),
          tenantId,
          locationId: null,
          service: 'products',
          edgeRecordId: uuidv7(),
          reason: SyncConflictReason.PUSH_REJECTED,
          edgePayload: { name: freshName },
          cloudPayload: null,
          status: SyncConflictStatus.OPEN,
        },
        { provider: undefined },
      )) as { _id: string }
      entityId = target._id
      targetCleanup.push(entityId)
    } else {
      entityId = uuidv7()
    }

    // Outbox anlegen — Create-Resolver erzwingt status='pending'; wir patchen
    // anschliessend auf 'rejected', um den Operator-Ausgangszustand zu bauen.
    const created = (await app.service('sync-outbox').create(
      {
        _id: uuidv7(),
        service: 'sync-conflicts',
        op,
        entityId,
        payload: { name: 'stale-payload' },
        occurredAt: new Date().toISOString(),
        syncSource: SyncSource.LIVE,
      },
      { provider: undefined },
    )) as SyncOutboxEntry
    outboxCleanup.push(created._id)

    await app.service('sync-outbox').patch(
      created._id,
      {
        status: SyncOutboxStatus.REJECTED,
        terminalAt: new Date().toISOString(),
        lastError: 'test rejection',
      },
      { provider: undefined },
    )

    return { outboxId: created._id, entityId, freshName }
  }

  it('lehnt Eintraege ab, deren Status != rejected ist', async () => {
    // Frischer Outbox-Eintrag ist per Default 'pending'.
    const pending = (await app.service('sync-outbox').create(
      {
        _id: uuidv7(),
        service: 'sync-conflicts',
        op: SyncOp.PATCH,
        entityId: uuidv7(),
        payload: {},
        occurredAt: new Date().toISOString(),
        syncSource: SyncSource.LIVE,
      },
      { provider: undefined },
    )) as SyncOutboxEntry
    outboxCleanup.push(pending._id)

    const service = app.service('sync-outbox') as unknown as ReEnqueueService
    await assert.rejects(
      service.reEnqueue({ id: pending._id }),
      (error: { name?: string }) => error.name === 'BadRequest',
    )

    // Der pending-Eintrag muss unveraendert sein.
    const stillPending = (await app.service('sync-outbox').get(pending._id, {
      provider: undefined,
    })) as SyncOutboxEntry
    assert.strictEqual(stillPending.status, SyncOutboxStatus.PENDING)
  })

  it('happy path patch — laedt aktuellen Payload, alter rejected-Eintrag wird entfernt', async () => {
    const { outboxId, entityId } = await makeRejectedOutboxEntry(SyncOp.PATCH)

    const service = app.service('sync-outbox') as unknown as ReEnqueueService
    const created = await service.reEnqueue({ id: outboxId })
    outboxCleanup.push(created._id)

    assert.strictEqual(created.op, SyncOp.PATCH, 'op muss beibehalten werden')
    assert.strictEqual(created.entityId, entityId, 'entityId zeigt weiterhin auf denselben Record')
    assert.strictEqual(created.status, SyncOutboxStatus.PENDING, 'neuer Eintrag ist pending')
    assert.strictEqual(created.service, 'sync-conflicts', 'service bleibt gleich')

    // Payload wurde frisch aus dem Ziel-Record geladen. Knex serialisiert
    // Objekt-Payloads in der TEXT-Spalte als JSON-String und parsed sie beim
    // Select nicht zurueck (siehe cloud-sync-scheduler.worker.ts §689) — der
    // Test spiegelt exakt das, was der Worker beim Auslesen der Row sieht.
    const rawPayload = created.payload
    assert.ok(rawPayload, 'payload wurde gesetzt (nicht null/undefined)')
    const parsed =
      typeof rawPayload === 'string' ? (JSON.parse(rawPayload) as { _id?: string }) : (rawPayload as { _id?: string })
    assert.strictEqual(parsed._id, entityId, 'frischer Payload traegt die Ziel-entityId')

    // Alter rejected-Eintrag wurde entfernt.
    await assert.rejects(
      app.service('sync-outbox').get(outboxId, { provider: undefined }),
      (error: { name?: string }) => error.name === 'NotFound',
    )
  })

  it('happy path create — Original-Op create bleibt create', async () => {
    const { outboxId, entityId } = await makeRejectedOutboxEntry(SyncOp.CREATE)

    const service = app.service('sync-outbox') as unknown as ReEnqueueService
    const created = await service.reEnqueue({ id: outboxId })
    outboxCleanup.push(created._id)

    // Regression-Anker: Original-Op MUSS beibehalten werden. Ein
    // „immer patch"-Verhalten wuerde in der Cloud 404 werfen, wenn das
    // urspruengliche create dort nie ankam.
    assert.strictEqual(created.op, SyncOp.CREATE)
    assert.strictEqual(created.entityId, entityId)
  })

  it('happy path remove — kein Edge-Record noetig, Payload bleibt undefined', async () => {
    const { outboxId, entityId } = await makeRejectedOutboxEntry(SyncOp.REMOVE, false)

    const service = app.service('sync-outbox') as unknown as ReEnqueueService
    const created = await service.reEnqueue({ id: outboxId })
    outboxCleanup.push(created._id)

    assert.strictEqual(created.op, SyncOp.REMOVE)
    assert.strictEqual(created.entityId, entityId)
    // Bei remove ist kein Payload-Refetch noetig (Cloud loescht per ID).
    // SQLite liefert ungesetzte TEXT-Spalten als `null` zurueck — akzeptiere
    // sowohl null als auch undefined als „leer".
    assert.ok(created.payload == null, 'remove-Payload bleibt leer')
  })

  it('BadRequest wenn Edge-Record bei create/patch nicht mehr existiert', async () => {
    const { outboxId } = await makeRejectedOutboxEntry(SyncOp.PATCH, false)

    const service = app.service('sync-outbox') as unknown as ReEnqueueService
    await assert.rejects(service.reEnqueue({ id: outboxId }), (error: { name?: string; message?: string }) => {
      assert.strictEqual(error.name, 'BadRequest')
      assert.match(String(error.message ?? ''), /Datensatz existiert nicht mehr/i)
      return true
    })

    // Guarantee: alter rejected-Eintrag bleibt erhalten — Operator hat weiterhin
    // die Wahl zwischen „Verwerfen" und „Erneut versuchen".
    const stillRejected = (await app.service('sync-outbox').get(outboxId, {
      provider: undefined,
    })) as SyncOutboxEntry
    assert.strictEqual(stillRejected.status, SyncOutboxStatus.REJECTED)
  })
})
