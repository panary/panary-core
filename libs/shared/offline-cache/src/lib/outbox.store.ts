import { Injectable, signal } from '@angular/core'

import { OfflineOutboxInput, OfflineOutboxPort, OfflineOutboxRejectedEntry } from '@panary/shared-common'

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

  // Reaktive Zähler für UI (Offline-Banner + Operator-Sicht). Werden nach jeder
  // Mutation aus dem Store nachgezogen — synchron lesbar via pendingCount()/rejectedCount().
  readonly #pending = signal(0)
  readonly #rejected = signal(0)

  attach(port: CacheStoragePort): void {
    this.#port = port
    void this.#refreshCounts()
  }

  detach(): void {
    this.#port = null
    this.#pending.set(0)
    this.#rejected.set(0)
  }

  isReady(): boolean {
    return this.#port !== null
  }

  async enqueue(input: OutboxEnqueueInput): Promise<void> {
    const entry: OutboxEntry = { ...input, status: 'pending', attempts: 0 }
    await this.#requirePort().put(CACHE_OUTBOX_STORE, entry)
    await this.#refreshCounts()
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
    await this.#refreshCounts()
  }

  async markRetry(id: string, nextAttemptAt: string, error?: string): Promise<void> {
    await this.#patch(id, entry => ({
      ...entry,
      status: 'pending',
      attempts: entry.attempts + 1,
      nextAttemptAt,
      lastError: error,
    }))
    await this.#refreshCounts()
  }

  async markRejected(id: string, error?: string): Promise<void> {
    await this.#patch(id, entry => ({ ...entry, status: 'rejected', attempts: entry.attempts + 1, lastError: error }))
    await this.#refreshCounts()
  }

  /** Reaktiver Zähler noch ausstehender (pending) Einträge — synchroner Signal-Read. */
  pendingCount(): number {
    return this.#pending()
  }

  /** Reaktiver Zähler terminal abgelehnter (rejected) Einträge — synchroner Signal-Read. */
  rejectedCount(): number {
    return this.#rejected()
  }

  /** Terminal abgelehnte Einträge (Detailliste) — für die Operator-Sicht (Phase 5). */
  async rejected(): Promise<readonly OfflineOutboxRejectedEntry[]> {
    return (await this.#all()).filter(entry => entry.status === 'rejected')
  }

  async clear(): Promise<void> {
    if (!this.#port) return
    await this.#port.clear(CACHE_OUTBOX_STORE)
    await this.#refreshCounts()
  }

  /** Zähler-Signale aus dem persistierten Store nachziehen (eine Lesung, beide Werte). */
  async #refreshCounts(): Promise<void> {
    const all = await this.#all()
    this.#pending.set(all.filter(entry => entry.status === 'pending').length)
    this.#rejected.set(all.filter(entry => entry.status === 'rejected').length)
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
