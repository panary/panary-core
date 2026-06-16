import { effect, inject, Injectable, OnDestroy, untracked } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import type { OfflineReplayPort } from '@panary/shared-common'
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
export class PosOutboxReplayService implements OnDestroy, OfflineReplayPort {
  readonly #connection = inject(ConnectionService)
  readonly #outbox = inject(OutboxStore)
  readonly #snackBar = inject(MatSnackBar)
  readonly #translate = inject(TranslateService)
  #replaying = false
  #pollTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    effect(() => {
      const status = this.#connection.connectionState().status
      const ready = this.#outbox.isReady() // reaktiv → feuert auch, wenn die Outbox NACH Connect bereit wird
      untracked(() => {
        if (status === 'authenticated' && ready) {
          void this.replayAll()
        } else if (status !== 'authenticated') {
          // Verbindung weg (auch mitten im Replay): einen evtl. hängenden Replay
          // entsperren, sonst blockiert `#replaying` jeden folgenden (Re)Connect-Replay.
          this.#replaying = false
        }
      })
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

  /** OfflineReplayPort: manueller Trigger (Operator „Erneut versuchen"). */
  replayNow(): Promise<void> {
    return this.replayAll()
  }

  async replayAll(): Promise<void> {
    if (this.#replaying || !this.#outbox.isReady()) return
    if (this.#connection.connectionState().status !== 'authenticated') return

    this.#replaying = true
    const rejectedBefore = this.#outbox.rejectedCount()
    try {
      const due = await this.#outbox.claimDue(new Date().toISOString())
      for (const entry of due) {
        // Verbindung mitten im Replay verloren? Abbrechen, statt in hängende
        // Socket-Buffer-Creates zu laufen — der nächste (Re)Connect setzt fort.
        if (this.#connection.connectionState().status !== 'authenticated') break
        await this.#replayOne(entry)
      }
    } finally {
      this.#replaying = false
    }

    // Terminal abgelehnte Übertragungen sind sonst still (nur in den Einstellungen
    // sichtbar) → Operator aktiv informieren.
    const newlyRejected = this.#outbox.rejectedCount() - rejectedBefore
    if (newlyRejected > 0) {
      this.#snackBar.open(
        this.#translate.instant('SETTINGS.OUTBOX_REPLAY_REJECTED', { count: newlyRejected }),
        'OK',
        { duration: 6000 },
      )
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
      await this.#outbox.markRejected(entry._id, this.#describeError(error))
      return
    }

    const nextAttemptAt = new Date(Date.now() + outboxBackoffMs(attempts)).toISOString()
    await this.#outbox.markRetry(entry._id, nextAttemptAt, this.#describeError(error))
  }

  #targetFor(service: string): ReplayTarget | null {
    // Rohe Feathers-Services (nicht BaseService — sonst Re-Queue + client-`_id`-Verlust).
    if (service === 'orders') {
      return this.#connection.orderService as unknown as ReplayTarget
    }
    if (service === 'pre-orders') {
      return this.#connection.preOrdersService as unknown as ReplayTarget
    }
    return null
  }

  /**
   * Aussagekräftige Fehlermeldung inkl. Feld-Details (AJV-`data`/`errors`) für die
   * Operator-Sicht — sonst steht dort nur das generische „validation failed", ohne
   * zu zeigen, WELCHES Feld den Replay killt.
   */
  #describeError(error: unknown): string {
    const e = error as Record<string, unknown> | null | undefined
    const base = typeof e?.['message'] === 'string' ? (e['message'] as string) : String(error)
    const raw = (e?.['data'] ?? e?.['errors']) as unknown
    if (!Array.isArray(raw) || raw.length === 0) return base
    const details = raw.slice(0, 5).map(item => {
      const d = item as { instancePath?: unknown; message?: unknown; params?: unknown }
      const path = typeof d?.instancePath === 'string' && d.instancePath ? d.instancePath : '/'
      const msg = typeof d?.message === 'string' ? d.message : 'invalid'
      const params = d?.params as { additionalProperty?: unknown } | undefined
      const extra = params && typeof params.additionalProperty === 'string' ? ` (${params.additionalProperty})` : ''
      return `${path}: ${msg}${extra}`
    })
    return `${base} — ${details.join('; ')}`
  }
}
