import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'
import { RouterLink } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'

/**
 * Hinweisbanner fuer cloud-verwaltete Seiten.
 *
 * - `read-only`: Standort-Stammdaten werden in der Cloud gepflegt, der Edge
 *   liest nur (Oeffnungszeiten, Pager, Tische, Standort).
 * - `printer-emergency`: Notfall-Modus laeuft — Drucker sind lokal editierbar
 *   und werden bei Cloud-Rueckkehr abgeglichen (ADR 0001).
 *
 * Ersetzt das frueher in `opening-hours.ts` eingebettete Markup. Dort stand ein
 * Phosphor-Icon (`ph ph-cloud-arrow-down`), obwohl der Admin-Client Phosphor nie
 * laedt — das Icon rendert seit jeher als leere Box. Hier bewusst
 * `material-symbols-outlined`, wie ueberall sonst im Admin-Client.
 */
@Component({
  selector: 'app-cloud-managed-banner',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (variant() === 'printer-emergency') {
      <div
        class="flex gap-3 items-start border border-orange-300 dark:border-orange-800/60
               bg-orange-50 dark:bg-orange-950/30 rounded-xl p-4"
      >
        <span
          class="material-symbols-outlined text-orange-600 dark:text-orange-400 shrink-0 mt-0.5"
          style="font-size: 20px; line-height: 1"
          aria-hidden="true"
          >emergency_home</span
        >
        <div class="text-sm min-w-0 flex-1">
          <p class="font-medium text-orange-900 dark:text-orange-100">
            {{ 'CLOUD_MANAGED.EMERGENCY_TITLE' | translate }}
          </p>
          <p class="text-orange-800 dark:text-orange-200 mt-1">
            {{ 'CLOUD_MANAGED.EMERGENCY_BODY' | translate }}
          </p>
          @if (sinceMin() !== null) {
            <p class="text-orange-700 dark:text-orange-300 mt-1 text-xs">
              {{ 'CLOUD_MANAGED.EMERGENCY_SINCE' | translate: { minutes: sinceMin() } }}
            </p>
          }
          @if (showEndButton()) {
            <button
              type="button"
              (click)="endEmergency.emit()"
              class="mt-3 px-3 py-1.5 text-xs font-medium rounded-lg border
                     border-orange-300 dark:border-orange-700 text-orange-900 dark:text-orange-100
                     hover:bg-orange-100 dark:hover:bg-orange-900/40 transition"
            >
              {{ 'CLOUD_MANAGED.EMERGENCY_END' | translate }}
            </button>
          }
        </div>
      </div>
    } @else {
      <div
        class="flex gap-3 items-start border border-amber-200 dark:border-amber-800/60
               bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4"
      >
        <span
          class="material-symbols-outlined text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
          style="font-size: 20px; line-height: 1"
          aria-hidden="true"
          >cloud_download</span
        >
        <div class="text-sm min-w-0 flex-1">
          <p class="font-medium text-amber-900 dark:text-amber-100">
            {{ 'CLOUD_MANAGED.TITLE' | translate }}
          </p>
          <p class="text-amber-800 dark:text-amber-200 mt-1">
            @if (sublineKey()) {
              {{ sublineKey()! | translate }}
            }
            {{ 'CLOUD_MANAGED.BODY' | translate }}
            <a routerLink="/cloud" class="underline hover:no-underline">
              {{ 'CLOUD_MANAGED.SHOW_CONNECTION' | translate }}
            </a>
          </p>
        </div>
      </div>
    }
  `,
})
export class CloudManagedBannerComponent {
  variant = input<'read-only' | 'printer-emergency'>('read-only')

  /** Seitenspezifische Kontextzeile, z.B. `CLOUD_MANAGED.SUBLINE_PAGERS`. */
  sublineKey = input<string | null>(null)

  /** Minuten seit Aktivierung des Notfall-Modus. Nur `printer-emergency`. */
  sinceMin = input<number | null>(null)

  /** Notausgang aus dem Notfall-Modus (ADR 0001). Nur `printer-emergency`. */
  showEndButton = input(false)
  endEmergency = output<void>()
}
