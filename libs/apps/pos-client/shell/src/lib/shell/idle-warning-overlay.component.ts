import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'

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
 * - **`z-[1200]`** liegt ueber dem CDK-Overlay-Container (1000). Die Warnung
 *   muss auch ueber einem offenen Abschreibungs- oder Tagesabschluss-Dialog
 *   erscheinen, sonst versteckt sie sich dahinter.
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
      class="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-8 backdrop-blur-sm"
      role="alertdialog"
      aria-live="assertive"
      [attr.aria-label]="'POS_IDLE.TITLE' | translate"
    >
      <div class="w-full max-w-xl rounded-3xl bg-white p-10 text-center shadow-2xl dark:bg-gray-900">
        <h2 class="text-2xl font-semibold text-gray-900 dark:text-gray-50">
          {{ 'POS_IDLE.TITLE' | translate }}
        </h2>

        <p class="mt-4 text-lg text-gray-600 dark:text-gray-300">
          {{ 'POS_IDLE.MESSAGE' | translate: { seconds: remainingSeconds() } }}
        </p>

        <div class="mt-6 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            class="h-full bg-amber-500 transition-[width] duration-1000 ease-linear"
            [style.width.%]="progressPercent()"
          ></div>
        </div>

        <p class="mt-4 text-sm text-gray-400">{{ 'POS_IDLE.HINT' | translate }}</p>

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

  readonly stayLoggedIn = output<void>()

  protected readonly progressPercent = computed(() => {
    const total = this.warningSeconds()
    if (total <= 0) return 0
    return Math.min(100, Math.max(0, (this.remainingSeconds() / total) * 100))
  })
}
