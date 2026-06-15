import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openCacheDatabase } from './cache-bootstrap'
import { IdbStorageAdapter } from './idb-storage.adapter'
import { OUTBOX_BACKOFF_MS, outboxBackoffMs } from './outbox'
import { OutboxEnqueueInput, OutboxStore } from './outbox.store'

const DB = 'outbox-test-db'

const input = (id: string, occurredAt: string): OutboxEnqueueInput => ({
  _id: id,
  service: 'orders',
  op: 'create',
  entityId: id,
  payload: { amount: 1 },
  occurredAt,
})

describe('OutboxStore', () => {
  let port: IdbStorageAdapter
  let outbox: OutboxStore

  beforeEach(async () => {
    port = new IdbStorageAdapter()
    await port.destroy(DB)
    await openCacheDatabase(port, DB, { version: 1, stores: [] }, 'build-1')
    outbox = new OutboxStore()
    outbox.attach(port)
  })

  afterEach(() => {
    port.close()
  })

  it('wirft, wenn vor attach() zugegriffen wird', async () => {
    const fresh = new OutboxStore()
    await expect(fresh.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))).rejects.toThrow(/attach/)
  })

  it('enqueue legt einen pending-Eintrag an', async () => {
    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    expect(await outbox.pendingCount()).toBe(1)
    const [entry] = await outbox.claimDue('2026-01-01T01:00:00.000Z')
    expect(entry?.status).toBe('pending')
    expect(entry?.attempts).toBe(0)
  })

  it('claimDue liefert FIFO nach occurredAt', async () => {
    await outbox.enqueue(input('o2', '2026-01-01T00:02:00.000Z'))
    await outbox.enqueue(input('o1', '2026-01-01T00:01:00.000Z'))
    const due = await outbox.claimDue('2026-01-01T01:00:00.000Z')
    expect(due.map(e => e._id)).toEqual(['o1', 'o2'])
  })

  it('claimDue respektiert nextAttemptAt (Backoff)', async () => {
    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.markRetry('o1', '2026-01-01T00:05:00.000Z', 'net')
    expect(await outbox.claimDue('2026-01-01T00:01:00.000Z')).toHaveLength(0)
    expect(await outbox.claimDue('2026-01-01T00:06:00.000Z')).toHaveLength(1)
  })

  it('markRetry erhöht attempts und hält pending', async () => {
    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.markRetry('o1', '2026-01-01T00:05:00.000Z')
    const due = await outbox.claimDue('2026-01-01T01:00:00.000Z')
    expect(due[0]?.attempts).toBe(1)
  })

  it('markAcked entfernt den Eintrag', async () => {
    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.markAcked('o1')
    expect(await outbox.pendingCount()).toBe(0)
  })

  it('markRejected setzt den Eintrag terminal rejected', async () => {
    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.markRejected('o1', 'terminal')
    expect(await outbox.pendingCount()).toBe(0)
    expect((await outbox.rejected()).map(e => e._id)).toEqual(['o1'])
  })

  it('clear leert die Outbox', async () => {
    await outbox.enqueue(input('o1', '2026-01-01T00:00:00.000Z'))
    await outbox.clear()
    expect(await outbox.pendingCount()).toBe(0)
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
