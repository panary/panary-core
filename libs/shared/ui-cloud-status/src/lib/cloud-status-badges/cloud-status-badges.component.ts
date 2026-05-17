import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'

import type { SyncStaleness, TokenExpiry } from './cloud-status.types'

/**
 * Schwebende Status-Badges fuer Cloud-Sync-Alter und Token-Restlaufzeit.
 *
 * Rendert pro Trigger eine eigene `fixed`-positionierte Pille (gleiche Optik
 * wie die OFFLINE/RE-PAIRING-Badges in `apps/pos-client/src/app/app.ts`).
 * Wenn `level === 'ok'` fuer einen Trigger, wird die jeweilige Pille nicht
 * gerendert — keine UI-Last und kein Operator-Noise im Normalbetrieb.
 *
 * Positionierung:
 *   - Sync-Alter:    `fixed top-25` (75px) — unter der RE-PAIRING-Pille
 *   - Token-Ablauf:  `fixed top-36` (134px)
 *
 * i18n-Reaktivitaet: Wir nutzen die `| translate`-Pipe statt
 * `TranslateService.instant()` in einem `computed()`. Der HttpLoader laedt
 * die Sprachdateien asynchron — ein `computed()` evaluiert nur bei Signal-
 * Reads neu, NICHT wenn der TranslateService spaeter den Cache fuellt.
 * Die Pipe abonniert intern `onTranslationChange` und re-rendert
 * automatisch, sobald die Sprachdatei geladen ist.
 *
 * Konsumiert von POS-Client (`apps/pos-client/src/app/app.ts`) und
 * Admin-Client (Shell-Layout).
 */
@Component({
  selector: 'lib-cloud-status-badges',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sync().level !== 'ok'; as _) {
      <div [class]="syncBadgeClasses()" style="top: 6.25rem;">
        <span class="material-symbols-outlined text-[14px]">cloud_sync</span>
        {{ syncMessageKey() | translate: syncMessageParams() }}
      </div>
    }
    @if (token().level !== 'ok'; as _) {
      <div [class]="tokenBadgeClasses()" style="top: 8.5rem;">
        <span class="material-symbols-outlined text-[14px]">key</span>
        {{ tokenMessageKey() | translate: tokenMessageParams() }}
      </div>
    }
  `,
})
export class CloudStatusBadgesComponent {
  sync = input.required<SyncStaleness>()
  token = input.required<TokenExpiry>()

  // Tailwind-Klassen identisch zu den existierenden Badges in
  // pos-client/src/app/app.ts:30 — bewusst dupliziert (kein Mixin),
  // damit die UI-Lib keinen Coupling-Pfad zu pos-client-Styles hat.
  private readonly BASE_CLASSES =
    'fixed left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-1.5 px-3 py-1 ' +
    'backdrop-blur rounded-full text-xs font-semibold border shadow-sm'

  protected readonly syncBadgeClasses = computed(() => this.classesForLevel(this.sync().level))
  protected readonly tokenBadgeClasses = computed(() => this.classesForLevel(this.token().level))

  protected readonly syncMessageKey = computed(() => {
    const s = this.sync()
    if (s.ageSec === null) return 'CLOUD_STATUS.SYNC_NEVER'
    const minutes = Math.floor(s.ageSec / 60)
    return minutes < 60 ? 'CLOUD_STATUS.SYNC_AGE_MIN' : 'CLOUD_STATUS.SYNC_AGE_HOUR'
  })

  protected readonly syncMessageParams = computed<Record<string, number | undefined>>(() => {
    const s = this.sync()
    if (s.ageSec === null) return {}
    const minutes = Math.floor(s.ageSec / 60)
    return minutes < 60 ? { minutes } : { hours: Math.floor(minutes / 60) }
  })

  protected readonly tokenMessageKey = computed(() => {
    const t = this.token()
    if (t.remainingSec === null || t.remainingSec <= 0) return 'CLOUD_STATUS.TOKEN_EXPIRED'
    const minutes = Math.floor(t.remainingSec / 60)
    return minutes < 60 ? 'CLOUD_STATUS.TOKEN_EXPIRES_IN_MINUTES' : 'CLOUD_STATUS.TOKEN_EXPIRES_IN_HOURS'
  })

  protected readonly tokenMessageParams = computed<Record<string, number | undefined>>(() => {
    const t = this.token()
    if (t.remainingSec === null || t.remainingSec <= 0) return {}
    const minutes = Math.floor(t.remainingSec / 60)
    return minutes < 60 ? { minutes } : { hours: Math.floor(minutes / 60) }
  })

  private classesForLevel(level: 'ok' | 'warn' | 'crit'): string {
    if (level === 'crit') {
      return `${this.BASE_CLASSES} bg-red-100/95 dark:bg-red-900/90 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800`
    }
    // warn (ok wird nicht gerendert, fail-safe Fallback ist amber)
    return `${this.BASE_CLASSES} bg-amber-100/95 dark:bg-amber-900/90 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-800`
  }
}
