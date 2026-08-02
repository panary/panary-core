import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { PosSessionService } from '@panary/auth/data-access'
import { LocationService } from '@panary/locations/data-access'
import { resolveAutoLogOffTimeoutMs } from '@panary/locations/domain'
import { isAutoLogOffEnabled } from '@panary/users/domain'
import { OrderDialogComponent } from '@panary/orders/feature-pos-order-dialog'
import { evaluateIdle, POS_IDLE_TICK_MS, resolveWarningMs, type PosIdlePhase } from './idle-evaluator'

/**
 * Ereignisse, die als Anwesenheit am Terminal zaehlen.
 *
 * `pointerdown` deckt Maus und Touch ab (Pointer Events vereinheitlichen
 * `mousedown`/`touchstart`), ein separater Touch-Listener ist unnoetig.
 *
 * Bewusst NICHT dabei: `mousemove`, `pointermove`, `touchmove`, `scroll`. Ein
 * aufliegender Finger auf dem Sunmi-Panel oder ein zappelnder USB-Scanner
 * wuerde die Sitzung sonst dauerhaft offen halten — also genau die Luecke, die
 * dieses Feature schliessen soll.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const

/**
 * `capture: true` ist Pflicht, nicht Geschmack: der Bestelldialog ruft an
 * mehreren Stellen `event.stopPropagation()`. In der Bubble-Phase kaemen diese
 * Interaktionen nie am `document` an und der Timer liefe waehrend der
 * intensivsten Arbeit ab. `passive: true`, weil nie `preventDefault()` folgt.
 */
const LISTENER_OPTIONS = { passive: true, capture: true } as const

/**
 * Inaktivitaets-Logout am POS-Terminal.
 *
 * Lebt in der Shell-Lib, weil `AppPosShellComponent` genau die
 * authentifizierten Routen umschliesst (`/setup` und `/login` liegen
 * ausserhalb) und die Shell im POS-Abhaengigkeitsgraph oben steht — sie darf
 * `LocationService`, `MatDialog` und den Bestelldialog gleichzeitig kennen.
 *
 * `providedIn: 'root'`, damit der Zustand einen Routenwechsel innerhalb der
 * Shell ueberlebt; die Bindung an die authentifizierten Routen leistet der
 * Lebenszyklus der Shell ueber `start()`/`stop()`.
 */
@Injectable({ providedIn: 'root' })
export class PosIdleLogoutService {
  #session = inject(PosSessionService)
  #locationService = inject(LocationService)
  #dialog = inject(MatDialog)

  /**
   * Zeitstempel der letzten Interaktion — bewusst ein Plain-Feld und kein
   * Signal. Die DOM-Listener feuern haeufig; ein Signal-Write pro Tastendruck
   * wuerde in der zoneless App jedes Mal Change Detection anstossen. So bleibt
   * der einzige Signal-Schreiber der 1-Hz-Takt, und ein Throttle, den man
   * falsch dimensionieren kann, wird gar nicht erst gebraucht.
   */
  #lastActivityAt = Date.now()

  #ticker: ReturnType<typeof setInterval> | undefined
  #running = false

  /** Sitzungs-Mitarbeiter aus dem localStorage; traegt seit dem Login `autoLogOff`. */
  readonly #sessionUser = signal<{ autoLogOff?: unknown } | null>(null)

  readonly #phase = signal<PosIdlePhase>('disabled')
  readonly #remainingSeconds = signal(0)

  readonly phase = this.#phase.asReadonly()
  readonly remainingSeconds = this.#remainingSeconds.asReadonly()

  /** Ist der Auto-Logoff fuer den angemeldeten Mitarbeiter aktiv? */
  readonly isEnabled = computed(() => isAutoLogOffEnabled(this.#sessionUser()))

  readonly #timeoutMs = computed(() => resolveAutoLogOffTimeoutMs(this.#locationService.genericUserSettings))

  /** Laenge des Vorwarnfensters in Sekunden — Bezugsgroesse des Fortschrittsbalkens. */
  readonly warningSeconds = computed(() => Math.round(resolveWarningMs(this.#timeoutMs()) / 1000))

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop())
  }

  /**
   * Ist die Frist ausgesetzt?
   *
   * Zwei Gruende, beide aus der Wahrheit abgeleitet statt gebucht — ein
   * vergessener Hold wuerde den Auto-Logoff dauerhaft und unsichtbar
   * abschalten:
   *
   * 1. **Offene Bestellannahme.** Der Entwurf lebt komponenten-privat im
   *    Bestelldialog und waere nach einem Logout verloren. Verschachtelte
   *    Dialoge (Numpad, Rabatt-Picker) aendern nichts — der Bestelldialog
   *    bleibt so lange in `openDialogs`.
   * 2. **Offline.** Die Wiederanmeldung braucht die serverseitige
   *    PIN-Pruefung; ein Logout ohne Verbindung sperrt das Terminal aus.
   */
  #isFrozen(): boolean {
    if (this.#session.isOffline()) return true
    return this.#dialog.openDialogs.some(ref => ref.componentInstance instanceof OrderDialogComponent)
  }

  /** Startet die Ueberwachung. Idempotent — ein zweiter Mount legt keinen zweiten Timer an. */
  start(): void {
    this.#readSessionUser()
    if (this.#running) return
    this.#running = true

    this.reset()
    for (const type of ACTIVITY_EVENTS) {
      document.addEventListener(type, this.#onActivity, LISTENER_OPTIONS)
    }
    this.#ticker = setInterval(() => this.#tick(), POS_IDLE_TICK_MS)
  }

  /** Beendet die Ueberwachung und raeumt Listener wie Timer ab. Idempotent. */
  stop(): void {
    if (!this.#running) return
    this.#running = false

    for (const type of ACTIVITY_EVENTS) {
      document.removeEventListener(type, this.#onActivity, LISTENER_OPTIONS)
    }
    if (this.#ticker) clearInterval(this.#ticker)
    this.#ticker = undefined

    this.#phase.set('disabled')
    this.#remainingSeconds.set(0)
  }

  /** Setzt die Frist auf die volle Dauer zurueck. */
  reset(): void {
    this.#lastActivityAt = Date.now()
    this.#phase.set(this.isEnabled() ? 'armed' : 'disabled')
    this.#remainingSeconds.set(0)
  }

  #onActivity = (): void => {
    this.#lastActivityAt = Date.now()
  }

  #readSessionUser(): void {
    const stored = localStorage.getItem('pos_current_user')
    if (!stored) {
      this.#sessionUser.set(null)
      return
    }
    try {
      this.#sessionUser.set(JSON.parse(stored))
    } catch {
      // Ein unlesbarer Sitzungs-Record darf die Kasse nicht offen halten:
      // `isAutoLogOffEnabled(null)` liefert `true`, der Timer laeuft also
      // mit der Fallback-Frist weiter.
      console.warn('[PosIdleLogoutService] pos_current_user ist unlesbar — Auto-Logoff bleibt aktiv.')
      this.#sessionUser.set(null)
    }
  }

  #tick(): void {
    const result = evaluateIdle({
      enabled: this.isEnabled(),
      frozen: this.#isFrozen(),
      timeoutMs: this.#timeoutMs(),
      lastActivityAt: this.#lastActivityAt,
      now: Date.now(),
    })

    // Eingefroren heisst: es wird kein Budget verbraucht. Beim Auftauen laeuft
    // damit automatisch die volle Frist neu — nicht der Rest von vorher. Ein
    // kurzer Netzwackler waehrend der Vorwarnung darf den Kassierer nicht im
    // naechsten Moment ausloggen.
    if (result.phase === 'frozen') this.#lastActivityAt = Date.now()

    this.#phase.set(result.phase)

    // Nur schreiben, wenn sich der angezeigte Wert aendert — sonst stoesst jeder
    // Takt eine Change Detection an, obwohl sich nichts bewegt.
    const nextRemaining = result.phase === 'warning' ? Math.ceil(result.remainingMs / 1000) : 0
    if (this.#remainingSeconds() !== nextRemaining) this.#remainingSeconds.set(nextRemaining)

    if (result.shouldLogout) {
      // Vor dem Logout zuruecksetzen: schlaegt `endSession` fehl (offline in
      // genau diesem Moment), soll nicht bei jedem weiteren Takt erneut
      // gefeuert werden.
      this.reset()
      void this.#session.endSession('idle')
    }
  }
}
