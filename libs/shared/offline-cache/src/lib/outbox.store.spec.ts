import 'fake-indexeddb/auto'
import { describe, expect, it, onTestFinished } from 'vitest'

import { openCacheDatabase } from './cache-bootstrap'
import { IdbStorageAdapter } from './idb-storage.adapter'
import { classifyOutboxError, OUTBOX_BACKOFF_MS, outboxBackoffMs } from './outbox'
import { OutboxEnqueueInput, OutboxStore } from './outbox.store'

const input = (id: string, occurredAt: string): OutboxEnqueueInput => ({
  _id: id,
  service: 'orders',
  op: 'create',
  entityId: id,
  payload: { amount: 1 },
  occurredAt,
})

// Outbox, Port UND Datenbankname je Test — siehe `.claude/rules/code-style.md` §10 und den
// Kommentar in `cache-bootstrap.spec.ts`. `onTestFinished` schliesst die Verbindung, sonst
// blockiert ein spaeteres deleteDB auf der noch offenen Connection.
let dbSeq = 0

async function createOutbox() {
  const port = new IdbStorageAdapter()
  const dbName = `outbox-test-db-${++dbSeq}`
  await openCacheDatabase(port, dbName, { version: 1, stores: [] }, 'build-1')
  const outbox = new OutboxStore()
  outbox.attach(port)
  onTestFinished(() => port.close())
  return { outbox, port, dbName }
}

describe('OutboxStore', () => {
  it('wirft, wenn vor attach() zugegriffen wird', async () => {
    const fresh = new OutboxStore()
    await expect(fresh.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))).rejects.toThrow(/attach/)
  })

  it('enqueue legt einen pending-Eintrag an', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    expect(await outbox.pendingCount()).toBe(1)
    const [entry] = await outbox.claimDue('2026-01-01T01:00:00.000Z')
    expect(entry?.status).toBe('pending')
    expect(entry?.attempts).toBe(0)
  })

  it('claimDue liefert FIFO nach occurredAt', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o2', '2026-01-01T00:02:00.000Z'))
    await outbox.enqueue(input('o1', '2026-01-01T00:01:00.000Z'))
    const due = await outbox.claimDue('2026-01-01T01:00:00.000Z')
    expect(due.map(e => e._id)).toEqual(['o1', 'o2'])
  })

  it('claimDue respektiert nextAttemptAt (Backoff)', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.markRetry('o1', '2026-01-01T00:05:00.000Z', 'net')
    expect(await outbox.claimDue('2026-01-01T00:01:00.000Z')).toHaveLength(0)
    expect(await outbox.claimDue('2026-01-01T00:06:00.000Z')).toHaveLength(1)
  })

  it('markRetry erhöht attempts und hält pending', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.markRetry('o1', '2026-01-01T00:05:00.000Z')
    const due = await outbox.claimDue('2026-01-01T01:00:00.000Z')
    expect(due[0]?.attempts).toBe(1)
  })

  it('markAcked entfernt den Eintrag', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.markAcked('o1')
    expect(await outbox.pendingCount()).toBe(0)
  })

  it('markRejected setzt den Eintrag terminal rejected', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.markRejected('o1', 'terminal')
    expect(await outbox.pendingCount()).toBe(0)
    expect((await outbox.rejected()).map(e => e._id)).toEqual(['o1'])
  })

  it('clear leert die Outbox', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.clear()
    expect(await outbox.pendingCount()).toBe(0)
  })

  it('pendingCount/rejectedCount sind synchrone, reaktive Zähler', async () => {
    const { outbox } = await createOutbox()

    expect(outbox.pendingCount()).toBe(0)
    expect(outbox.rejectedCount()).toBe(0)
    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.enqueue(input('o2', '2026-01-01T00:01:00.000Z'))
    expect(outbox.pendingCount()).toBe(2)
    await outbox.markRejected('o1', 'terminal')
    expect(outbox.pendingCount()).toBe(1)
    expect(outbox.rejectedCount()).toBe(1)
  })

  it('attach zieht die Zähler aus dem persistierten Store nach', async () => {
    const { outbox, port } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    const reattached = new OutboxStore()
    reattached.attach(port)
    await new Promise(resolve => setTimeout(resolve, 0)) // attach() refresht asynchron
    expect(reattached.pendingCount()).toBe(1)
  })

  it('detach setzt die Zähler zurück', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    outbox.detach()
    expect(outbox.pendingCount()).toBe(0)
    expect(outbox.rejectedCount()).toBe(0)
  })

  it('requeueRejected setzt rejected → pending zurück', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.markRejected('o1', 'terminal')
    expect(outbox.rejectedCount()).toBe(1)
    const count = await outbox.requeueRejected()
    expect(count).toBe(1)
    expect(outbox.rejectedCount()).toBe(0)
    expect(outbox.pendingCount()).toBe(1)
    const [entry] = await outbox.claimDue('2026-01-01T01:00:00.000Z')
    expect(entry?.status).toBe('pending')
    expect(entry?.attempts).toBe(0)
  })

  it('resetPendingBackoff macht backed-off pending-Einträge sofort fällig', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.markRetry('o1', '2026-01-01T05:00:00.000Z', 'transient') // Backoff weit in der Zukunft
    expect(await outbox.claimDue('2026-01-01T00:10:00.000Z')).toHaveLength(0)
    const count = await outbox.resetPendingBackoff()
    expect(count).toBe(1)
    const due = await outbox.claimDue('2026-01-01T00:10:00.000Z')
    expect(due.map(e => e._id)).toEqual(['o1'])
    expect(due[0]?.attempts).toBe(0)
  })

  it('pendingEntityIds liefert nur entityIds von pending-Einträgen', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.enqueue(input('o2', '2026-01-01T00:01:00.000Z'))
    await outbox.markRejected('o2', 'terminal')
    expect(await outbox.pendingEntityIds()).toEqual(['o1'])
  })

  it('clearRejected löscht abgelehnte Einträge, lässt pending unberührt', async () => {
    const { outbox } = await createOutbox()

    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.enqueue(input('o2', '2026-01-01T00:01:00.000Z'))
    await outbox.markRejected('o1', 'terminal')
    const count = await outbox.clearRejected()
    expect(count).toBe(1)
    expect(outbox.rejectedCount()).toBe(0)
    expect(outbox.pendingCount()).toBe(1)
    expect((await outbox.rejected()).length).toBe(0)
    const due = await outbox.claimDue('2026-01-01T01:00:00.000Z')
    expect(due.map(e => e._id)).toEqual(['o2'])
  })
})

describe('outboxBackoffMs', () => {
  it('liefert 0 für attempts ≤ 0', () => {
    expect(outboxBackoffMs(0)).toBe(0)
  })

  it('folgt dem Plan und deckelt am letzten Wert', () => {
    expect(outboxBackoffMs(1)).toBe(OUTBOX_BACKOFF_MS[0])
    expect(outboxBackoffMs(99)).toBe(OUTBOX_BACKOFF_MS[OUTBOX_BACKOFF_MS.length - 1])
  })
})

describe('classifyOutboxError', () => {
  it('erkennt "already-exists" (409 / Duplikat-Meldung)', () => {
    expect(classifyOutboxError({ code: 409 })).toBe('already-exists')
    expect(classifyOutboxError(new Error('UNIQUE constraint failed'))).toBe('already-exists')
  })

  it('erkennt terminale Fehler (400/401/403/422)', () => {
    expect(classifyOutboxError({ code: 400 })).toBe('terminal')
    expect(classifyOutboxError({ code: 403 })).toBe('terminal')
  })

  it('behandelt Netz-/Serverfehler als transient', () => {
    expect(classifyOutboxError({ code: 500 })).toBe('transient')
    expect(classifyOutboxError(new Error('Network error'))).toBe('transient')
    expect(classifyOutboxError(null)).toBe('transient')
  })
})
