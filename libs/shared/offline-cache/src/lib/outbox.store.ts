import { Injectable } from '@angular/core'

import { OfflineOutboxInput, OfflineOutboxPort } from '@panary/shared-common'

import { CACHE_OUTBOX_STORE } from './cache-bootstrap'
import { CacheStoragePort } from './cache-storage.port'
import { OutboxEntry } from './outbox'

/** Eingabe-Alias (= `OfflineOutboxInput` aus shared-common). */
export type OutboxEnqueueInput = OfflineOutboxInput

/**
 * Persistenz der Offline-Outbox über den geteilten {@link CacheStoragePort}. Der Port
 * wird via `attach()` vom Cache-Bootstrap durchgereicht (gleiche IndexedDB-Verbindung
 * wie der `OfflineCacheStore`). Backoff-/Replay-Steuerung liegt im Replay-Service
 * (pos-client) — dieser Store ist reine Persistenz.
 */
@Injectable()
export class OutboxStore implements OfflineOutboxPort {
  #port: CacheStoragePort | null = null

  attach(port: CacheStoragePort): void {
    this.#port = port
  }

  detach(): void {
    this.#port = null
  }

  isReady(): boolean {
    return this.#port !== null
  }

  async enqueue(input: OutboxEnqueueInput): Promise<void> {
    const entry: OutboxEntry = { ...input, status: 'pending', attempts: 0 }
    await this.#requirePort().put(CACHE_OUTBOX_STORE, entry)
  }

  /** Fällige Einträge (pending, `nextAttemptAt` fehlt oder ≤ now), FIFO nach `occurredAt`. */
  async claimDue(nowIso: string): Promise<OutboxEntry[]> {
    const all = await this.#all()
    return all
      .filter(entry => entry.status === 'pending' && (!entry.nextAttemptAt || entry.nextAttemptAt <= nowIso))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  }

  async markAcked(id: string): Promise<void> {
    await this.#requirePort().delete(CACHE_OUTBOX_STORE, id)
  }

  async markRetry(id: string, nextAttemptAt: string, error?: string): Promise<void> {
    await this.#patch(id, entry => ({
      ...entry,
      status: 'pending',
      attempts: entry.attempts + 1,
      nextAttemptAt,
      lastError: error,
    }))
  }

  async markRejected(id: string, error?: string): Promise<void> {
    await this.#patch(id, entry => ({ ...entry, status: 'rejected', attempts: entry.attempts + 1, lastError: error }))
  }

  /** Anzahl noch ausstehender (pending) Einträge — für den UI-Zähler. */
  async pendingCount(): Promise<number> {
    return (await this.#all()).filter(entry => entry.status === 'pending').length
  }

  /** Terminal abgelehnte Einträge — für die Operator-Sicht (Phase 5). */
  async rejected(): Promise<OutboxEntry[]> {
    return (await this.#all()).filter(entry => entry.status === 'rejected')
  }

  async clear(): Promise<void> {
    if (!this.#port) return
    await this.#port.clear(CACHE_OUTBOX_STORE)
  }

  async #all(): Promise<OutboxEntry[]> {
    if (!this.#port) return []
    return this.#port.getAll<OutboxEntry>(CACHE_OUTBOX_STORE)
  }

  async #patch(id: string, update: (entry: OutboxEntry) => OutboxEntry): Promise<void> {
    const current = await this.#requirePort().get<OutboxEntry>(CACHE_OUTBOX_STORE, id)
    if (!current) return
    await this.#requirePort().put(CACHE_OUTBOX_STORE, update(current))
  }

  #requirePort(): CacheStoragePort {
    if (!this.#port) {
      throw new Error('OutboxStore: kein Port — attach() zuerst aufrufen.')
    }
    return this.#port
  }
}
