import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { syncTopLayer, type TopLayerElement } from '@panary/shared/ui-notifications'

/**
 * Kuendigt den Inaktivitaets-Logout an.
 *
 * Kein eigener Timer: die Restsekunden kommen als Signal-Input aus dem
 * `PosIdleLogoutService`. In der zoneless App wuerde ein lokaler `setInterval`
 * auf einer Plain-Property keine Change Detection ausloesen und der Zaehler
 * stuende still.
 *
 * Zwei Entscheidungen zum Markup, die nicht ins Template passen (Backticks
 * wuerden dort das Template-Literal beenden):
 *
 * - **Top-Layer statt `z-index`** (core#1080). Die Warnung muss ueber jedem
 *   offenen Dialog stehen, auch ueber der Rueckfrage „Bestellung verwerfen?“.
 *   Die CDK legt Dialoge in den Top-Layer (Popover-API, core#1060), dagegen half
 *   das fruehere `z-[1200]` nicht. Die Warnung ist deshalb selbst ein Popover
 *   und oeffnet nach dem Dialog, liegt also darueber. Einen Listener, der sie
 *   nach jedem spaeteren Popover wieder hochholt, gibt es bewusst nicht: Er
 *   spraenge mit dem gleichen Listener der Meldungsebene hin und her, und ein
 *   neuer Dialog braucht einen Tipp, der die Warnung ohnehin beendet. Ohne
 *   Popover-API (alte WebViews) bleibt `z-[1200]` als Rueckfall.
 * - **Deckender Backdrop:** waehrend des Countdowns darf ein Tap nicht
 *   versehentlich einen Button darunter treffen. Weil der Aktivitaets-Listener
 *   am `document` in der Capture-Phase haengt, zaehlt derselbe Tap trotzdem als
 *   Anwesenheit — "irgendwohin tippen" verlaengert die Sitzung, ohne etwas
 *   auszuloesen. Daher der Hinweistext im Overlay.
 */
@Component({
  selector: 'lib-idle-warning-overlay',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #layer
      popover="manual"
      class="fixed inset-0 z-[1200] m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0
             bg-shell/70 p-8 text-inherit backdrop-blur-sm"
      role="alertdialog"
      aria-live="assertive"
      [attr.aria-label]="'POS_IDLE.TITLE' | translate"
    >
      <div class="w-full max-w-xl rounded-3xl bg-surface-input p-10 text-center shadow-2xl">
        <h2 class="text-2xl font-semibold text-ink">
          {{ 'POS_IDLE.TITLE' | translate }}
        </h2>

        <p class="mt-4 text-lg text-ink-muted dark:text-ink">
          {{ 'POS_IDLE.MESSAGE' | translate: { seconds: remainingSeconds() } }}
        </p>

        @if (discardsOrder()) {
          <p class="mt-3 text-lg font-semibold text-danger-ink" data-testid="idle-discards-order">
            {{ 'POS_IDLE.DISCARDS_ORDER' | translate }}
          </p>
        }

        <div class="mt-6 h-2 w-full overflow-hidden rounded-full bg-line">
          <div
            class="h-full bg-amber-500 transition-[width] duration-1000 ease-linear"
            [style.width.%]="progressPercent()"
          ></div>
        </div>

        <p class="mt-4 text-sm text-ink-faint">{{ 'POS_IDLE.HINT' | translate }}</p>

        <button
          type="button"
          class="mt-8 min-h-16 w-full rounded-2xl bg-emerald-600 px-6 text-lg font-semibold text-white
                 transition-colors hover:bg-emerald-700 active:bg-emerald-800"
          (click)="stayLoggedIn.emit()"
        >
          {{ 'POS_IDLE.STAY' | translate }}
        </button>
      </div>
    </div>
  `,
})
export class IdleWarningOverlayComponent {
  readonly remainingSeconds = input.required<number>()
  /** Gesamtes Vorwarnfenster in Sekunden — Bezugsgroesse des Fortschrittsbalkens. */
  readonly warningSeconds = input.required<number>()
  /** Liegt eine angefangene Bestellung in der Kasse, verwirft der Logout sie (core#1064). */
  readonly discardsOrder = input(false)

  readonly stayLoggedIn = output<void>()

  private readonly layer = viewChild<ElementRef<HTMLElement>>('layer')

  constructor() {
    afterNextRender(() => {
      const layer = this.layer()?.nativeElement as TopLayerElement | undefined
      if (layer) syncTopLayer(layer, true, 0)
    })
  }

  protected readonly progressPercent = computed(() => {
    const total = this.warningSeconds()
    if (total <= 0) return 0
    return Math.min(100, Math.max(0, (this.remainingSeconds() / total) * 100))
  })
}
