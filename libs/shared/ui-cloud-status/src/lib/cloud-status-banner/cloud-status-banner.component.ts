import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'

import type { CloudBanner, CloudBannerActionKind } from '@panary/shared/data-access'

/**
 * Einziger, priorisierter Cloud-Status-Banner.
 *
 * Rendert genau EINEN Banner-Zustand (vom `CloudStatusBannerService` ausgewaehlt,
 * hoechste Gewichtung gewinnt) als zentrierte, abgerundete Karte oben am Viewport.
 * Inhalt adaptiv: Info = kompakt (Icon + Text), kritisch = mit Subline +
 * Action-Button. Farbe nach Schwere. `null` → nichts rendern.
 *
 * i18n-Reaktivitaet ueber die `| translate`-Pipe (nicht `instant()` in einem
 * `computed()`) — die Pipe re-rendert automatisch, sobald die Sprachdatei async
 * geladen ist (analog `cloud-status-badges.component.ts`).
 *
 * `enableOfflineModeAction` schaltet den „Offline-Modus aktivieren"-Button frei.
 * Default false (POS/Device hat kein RBAC-Recht auf `cloud-connection`); der
 * Admin-Host setzt true. Die `reload`-Aktion ist ueberall verfuegbar.
 *
 * Konsumiert vom POS-Client und Admin-Client (`app.ts`).
 */
@Component({
  selector: 'lib-cloud-status-banner',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (banner(); as b) {
      <div class="fixed top-3 left-1/2 -translate-x-1/2 z-[1000] w-auto max-w-[min(92vw,40rem)]">
        <div [class]="cardClasses()" role="status" aria-live="polite">
          <div class="flex items-start gap-2.5">
            <span class="material-symbols-outlined text-[18px] leading-none mt-0.5" aria-hidden="true">{{ b.icon }}</span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold leading-snug">{{ b.messageKey | translate: (b.params ?? {}) }}</p>
              @if (b.sublineKey) {
                <p class="text-xs opacity-90 mt-0.5 leading-snug">{{ b.sublineKey | translate: (b.sublineParams ?? {}) }}</p>
              }
            </div>
            @if (showAction()) {
              <button type="button" (click)="onAction()" [class]="actionClasses()">
                {{ b.action!.labelKey | translate }}
              </button>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class CloudStatusBannerComponent {
  banner = input<CloudBanner | null>(null)
  enableOfflineModeAction = input<boolean>(false)

  action = output<CloudBannerActionKind>()

  private readonly BASE_CARD = 'rounded-xl border backdrop-blur shadow-md px-4 py-2.5'

  protected readonly cardClasses = computed(() => {
    const level = this.banner()?.level ?? 'info'
    if (level === 'crit') {
      return `${this.BASE_CARD} bg-red-50/95 dark:bg-red-900/90 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800`
    }
    if (level === 'warn') {
      return `${this.BASE_CARD} bg-amber-50/95 dark:bg-amber-900/90 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-800`
    }
    return `${this.BASE_CARD} bg-white/95 dark:bg-gray-900/90 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700`
  })

  protected readonly actionClasses = computed(() => {
    const base =
      'shrink-0 self-center text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-colors disabled:opacity-50'
    const level = this.banner()?.level ?? 'info'
    if (level === 'warn') {
      return `${base} bg-amber-700 dark:bg-amber-600 hover:bg-amber-800 dark:hover:bg-amber-500`
    }
    // crit (und info-Fallback) — Aktionen treten praktisch nur auf crit-Bannern auf.
    return `${base} bg-red-600 dark:bg-red-600 hover:bg-red-700 dark:hover:bg-red-500`
  })

  /** Reload immer; activate-offline-mode nur, wenn vom Host freigeschaltet. */
  protected readonly showAction = computed(() => {
    const a = this.banner()?.action
    if (!a) return false
    if (a.kind === 'activate-offline-mode') return this.enableOfflineModeAction()
    return true
  })

  protected onAction(): void {
    const a = this.banner()?.action
    if (a) this.action.emit(a.kind)
  }
}
