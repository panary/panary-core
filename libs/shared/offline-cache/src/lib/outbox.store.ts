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
  // Reaktive Bereitschaft: `isReady()` liest dieses Signal, damit ein effect() (Replay-
  // Trigger) auch dann erneut feuert, wenn die Outbox NACH dem Connect bereit wird.
  readonly #ready = signal(false)

  attach(port: CacheStoragePort): void {
    this.#port = port
    this.#ready.set(true)
    void this.#refreshCounts()
  }

  detach(): void {
    this.#port = null
    this.#ready.set(false)
    this.#pending.set(0)
    this.#rejected.set(0)
  }

  isReady(): boolean {
    return this.#ready()
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

  /** `entityId`s aller pending-Einträge — für den Orders-Mirror (Offline-Orders bewahren). */
  async pendingEntityIds(): Promise<readonly string[]> {
    return (await this.#all()).filter(entry => entry.status === 'pending').map(entry => entry.entityId)
  }

  /** Reaktiver Zähler terminal abgelehnter (rejected) Einträge — synchroner Signal-Read. */
  rejectedCount(): number {
    return this.#rejected()
  }

  /** Terminal abgelehnte Einträge (Detailliste) — für die Operator-Sicht (Phase 5). */
  async rejected(): Promise<readonly OfflineOutboxRejectedEntry[]> {
    return (await this.#all()).filter(entry => entry.status === 'rejected')
  }

  /** Alle rejected-Einträge zurück auf pending setzen (Operator-Retry). Anzahl re-eingereiht. */
  async requeueRejected(): Promise<number> {
    const rejected = (await this.#all()).filter(entry => entry.status === 'rejected')
    for (const entry of rejected) {
      await this.#requirePort().put(CACHE_OUTBOX_STORE, {
        ...entry,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: undefined,
        lastError: undefined,
      })
    }
    await this.#refreshCounts()
    return rejected.length
  }

  /** Alle rejected-Einträge endgültig löschen (Operator-„Verwerfen"). Anzahl gelöscht. */
  async clearRejected(): Promise<number> {
    const rejected = (await this.#all()).filter(entry => entry.status === 'rejected')
    for (const entry of rejected) {
      await this.#requirePort().delete(CACHE_OUTBOX_STORE, entry._id)
    }
    await this.#refreshCounts()
    return rejected.length
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
