import { effect, inject, Injectable, OnDestroy, untracked } from '@angular/core'
import { ConnectionService } from '@panary/shared/data-access'
import { classifyOutboxError, OUTBOX_MAX_ATTEMPTS, outboxBackoffMs, OutboxEntry, OutboxStore } from '@panary/shared/offline-cache'

/** Minimaler Feathers-Service-Ausschnitt für das Replay (create/patch mit voller Payload). */
interface ReplayTarget {
  create(data: unknown): Promise<unknown>
  patch(id: string, data: unknown): Promise<unknown>
}

/** Poll-Intervall für fällige Retries (am kürzesten Backoff = 30 s ausgerichtet). */
const REPLAY_POLL_MS = 30_000

/**
 * Spielt die Offline-Outbox beim (Re-)Connect zum Server zurück (Phase 4, Replay).
 * Pro Eintrag: Server-create/patch mit dem vollständigen Payload inkl. client-`_id`
 * → der Server upsertet idempotent (Order-Resolver: `_id = value || uuidv7()`),
 * re-stampt die finale `dailySequenceNumber` und überspringt das TSE-Signieren
 * (`offlineCreated`). Erfolg → acked; „existiert bereits" → acked (idempotent);
 * terminale Fehler → rejected (Operator-Sicht, Phase 5); transient → Backoff-Retry.
 *
 * Geht über die rohen Feathers-Services (`ConnectionService`), NICHT über den
 * `BaseService` — sonst würde dessen Offline-Routing den Eintrag erneut einreihen
 * und die client-`_id` weglassen.
 */
@Injectable()
export class PosOutboxReplayService implements OnDestroy {
  readonly #connection = inject(ConnectionService)
  readonly #outbox = inject(OutboxStore)
  #replaying = false
  #pollTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    effect(() => {
      const status = this.#connection.connectionState().status
      const ready = this.#outbox.isReady()
      if (status === 'authenticated' && ready) {
        untracked(() => void this.replayAll())
      }
    })

    // Der Connect-Effekt feuert nur beim Status-Wechsel auf 'authenticated'. Einträge,
    // die danach in den Backoff laufen (transient), bleiben sonst liegen, solange die
    // Verbindung 'authenticated' bleibt. Ein leichter Poll zieht fällige Retries nach,
    // solange überhaupt etwas aussteht (replayAll() ist durch #replaying + claimDue
    // idempotent und kurzschließt offline).
    this.#pollTimer = setInterval(() => {
      if (this.#outbox.isReady() && this.#outbox.pendingCount() > 0) {
        void this.replayAll()
      }
    }, REPLAY_POLL_MS)
  }

  ngOnDestroy(): void {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer)
      this.#pollTimer = null
    }
  }

  async replayAll(): Promise<void> {
    if (this.#replaying || !this.#outbox.isReady()) return
    if (this.#connection.connectionState().status !== 'authenticated') return

    this.#replaying = true
    try {
      const due = await this.#outbox.claimDue(new Date().toISOString())
      for (const entry of due) {
        await this.#replayOne(entry)
      }
    } finally {
      this.#replaying = false
    }
  }

  async #replayOne(entry: OutboxEntry): Promise<void> {
    const target = this.#targetFor(entry.service)
    if (!target) {
      await this.#outbox.markRejected(entry._id, `Unbekannter Service: ${entry.service}`)
      return
    }
    try {
      if (entry.op === 'create') {
        await target.create(entry.payload)
      } else {
        await target.patch(entry.entityId, entry.payload)
      }
      await this.#outbox.markAcked(entry._id)
    } catch (error) {
      await this.#handleFailure(entry, error)
    }
  }

  async #handleFailure(entry: OutboxEntry, error: unknown): Promise<void> {
    const classification = classifyOutboxError(error)
    if (classification === 'already-exists') {
      // Server kennt den Datensatz bereits (z.B. verlorenes ack) → idempotent acked.
      await this.#outbox.markAcked(entry._id)
      return
    }

    const attempts = entry.attempts + 1
    if (classification === 'terminal' || attempts >= OUTBOX_MAX_ATTEMPTS) {
      await this.#outbox.markRejected(entry._id, this.#message(error))
      return
    }

    const nextAttemptAt = new Date(Date.now() + outboxBackoffMs(attempts)).toISOString()
    await this.#outbox.markRetry(entry._id, nextAttemptAt, this.#message(error))
  }

  #targetFor(service: string): ReplayTarget | null {
    // Phase 4: nur `orders`. Weitere transactional-Services hier ergänzen.
    if (service === 'orders') {
      return this.#connection.orderService as unknown as ReplayTarget
    }
    return null
  }

  #message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
