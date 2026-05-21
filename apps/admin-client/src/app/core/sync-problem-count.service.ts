import { inject, Injectable, signal } from '@angular/core'
import { ApiService } from './api.service'

/**
 * Aggregat-Service fuer den Sync-Problem-Counter (Sidebar-Badge + Sync-Status-
 * Hauptseite). Haelt das Total (rejected Outbox + offene sync-conflicts) als
 * Signal — Konsumenten reagieren live.
 *
 * Wird sowohl von der `AdminLayoutComponent` (Sidebar-Badge mit Polling alle
 * 60s) als auch von der `SyncConflictsComponent` (sofortiger Refresh nach
 * Operator-Aktion) genutzt. Dadurch springt der Badge in der Sidebar sofort
 * auf den neuen Stand, statt erst auf den naechsten Poll-Tick zu warten.
 */
@Injectable({ providedIn: 'root' })
export class SyncProblemCountService {
  private api = inject(ApiService)

  /**
   * Aktueller Problem-Counter (ROT) — Summe aus rejected Outbox + offene
   * Konflikte. Diese Records sind steckengeblieben und brauchen einen Eingriff.
   */
  readonly count = signal<number>(0)

  /**
   * Records, die gerade im automatischen Retry-Backoff stecken (AMBER) —
   * `sync-outbox` mit status=pending und nextAttemptAt in der Zukunft. Diese
   * heilen sich i.d.R. selbst (transiente Cloud-Fehler) und zaehlen daher NICHT
   * zum roten Problem-Counter; sie sind nur ein Fruehwarn-Hinweis.
   */
  readonly retryingCount = signal<number>(0)

  /**
   * Laedt die Counter neu. Defensive Catch-Logik: ein gescheiterter Service
   * (z.B. sync-conflicts nicht erreichbar) blockiert den anderen nicht. Jeder
   * Fehler wird verschluckt — die Badge bleibt im Zweifel auf dem letzten
   * bekannten Stand, ein 60s-Poll-Retry holt den richtigen Wert spaeter.
   */
  async refresh(): Promise<void> {
    let total = 0
    try {
      const rejected = await this.api.find('sync-outbox', { status: 'rejected', $limit: 0 })
      total += rejected.total ?? 0
    } catch {
      // ignore — Service evtl. nicht erreichbar
    }
    try {
      const conflicts = await this.api.find('sync-conflicts', { status: 'open', $limit: 0 })
      total += conflicts.total ?? 0
    } catch {
      // ignore
    }
    this.count.set(total)

    try {
      const now = new Date().toISOString()
      const retrying = await this.api.find('sync-outbox', {
        status: 'pending',
        nextAttemptAt: { $gt: now },
        $limit: 0,
      })
      this.retryingCount.set(retrying.total ?? 0)
    } catch {
      // ignore
    }
  }
}
