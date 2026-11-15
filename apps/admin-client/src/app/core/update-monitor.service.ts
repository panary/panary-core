import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core'
import { APP_CONFIG } from '@panary/shared/data-access-config'
import { isVersionDrift } from '@panary/shared-common'
import { EdgeVersionService } from './edge-version.service'

/** Gleicher Takt wie die Statuszeile: Ein Edge-Update wird ohne Eingriff nach spätestens einer Minute sichtbar. */
export const UPDATE_POLL_INTERVAL_MS = 60_000

/**
 * Erkennt, ob der Edge inzwischen eine andere Version meldet als die, mit der dieser Tab geladen wurde (core#1439).
 *
 * Der Admin-Client kommt vom Edge, beide tragen dieselbe Root-`package.json`-Version. Ein Edge-Update bei offenem
 * Tab lässt `/health` also eine andere Nummer melden als die geladene Oberfläche trägt. Der Hinweis ist reine
 * Auskunft, nie eine Sperre (ADR 0070): Er sagt „neu laden", mehr nicht.
 *
 * - **Nicht vergleichbar = kein Hinweis.** `staging-<sha>`, `0.0.0` und alles andere ohne `YY.MM.INDEX`
 *   erkennt `isVersionDrift` als nicht vergleichbar.
 * - **Nicht erreichbar = kein neuer Zustand.** Antwortet `/health` nicht (Edge startet gerade neu), bleibt die
 *   zuletzt bekannte Version stehen: Ein schon gezeigter Hinweis verschwindet im Update nicht, und ohne
 *   Antwort erscheint auch keiner.
 */
@Injectable({ providedIn: 'root' })
export class UpdateMonitorService {
  private readonly edgeVersion = inject(EdgeVersionService)
  private readonly destroyRef = inject(DestroyRef)
  private readonly buildVersion = inject(APP_CONFIG).appVersion

  private readonly serverVersion = signal<string | null>(null)
  private readonly dismissedFor = signal<string | null>(null)

  /** Der Edge meldet eine andere (vergleichbare) Version als der geladene Build. */
  readonly updateAvailable = computed(() => isVersionDrift(this.buildVersion, this.serverVersion()))

  /**
   * Ob der Hinweis jetzt steht. „Später" blendet ihn für genau diese Edge-Version aus; kommt eine noch
   * neuere, erscheint er wieder.
   */
  readonly visible = computed(() => this.updateAvailable() && this.dismissedFor() !== this.serverVersion())

  /** Die Version, auf die das Neuladen führt. */
  readonly latestVersion = computed(() => this.serverVersion())

  private started = false

  /** Idempotent: Der erste Aufruf fragt sofort ab und startet danach den Takt und den Fokuswechsel. */
  start(): void {
    if (this.started) return
    this.started = true

    void this.poll()
    const timer = setInterval(() => void this.poll(), UPDATE_POLL_INTERVAL_MS)
    this.destroyRef.onDestroy(() => clearInterval(timer))

    // Kehrt jemand in den Tab zurück, ist der beste Moment für die Frage: Hintergrund-Tabs drosseln Timer.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void this.poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onVisible))
  }

  dismiss(): void {
    this.dismissedFor.set(this.serverVersion())
  }

  reload(): void {
    window.location.reload()
  }

  private async poll(): Promise<void> {
    const version = await this.edgeVersion.load()
    if (version !== null) this.serverVersion.set(version)
  }
}
