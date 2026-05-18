import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'

import type { SyncStaleness, TokenExpiry } from './cloud-status.types'

/**
 * Status-Badges fuer Cloud-Sync-Alter und Token-Restlaufzeit.
 *
 * Rendert pro Trigger eine inline-Pille (kein eigenes `fixed`-Positioning).
 * Der Konsument umschliesst die Komponente mit einem Stack-Container (z.B.
 * `fixed top-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2`),
 * sodass mehrere Pillen sauber untereinander stapeln und beim Ausblenden
 * einzelner Pillen die anderen nach oben rutschen — kein Cascade mit
 * hardcoded `top`-Offsets.
 *
 * Wenn `level === 'ok'` fuer einen Trigger, wird die jeweilige Pille nicht
 * gerendert — keine UI-Last und kein Operator-Noise im Normalbetrieb.
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
      <div [class]="syncBadgeClasses()">
        <span class="material-symbols-outlined text-[14px]">cloud_sync</span>
        {{ syncMessageKey() | translate: syncMessageParams() }}
      </div>
    }
    @if (token().level !== 'ok'; as _) {
      <div [class]="tokenBadgeClasses()">
        <span class="material-symbols-outlined text-[14px]">key</span>
        {{ tokenMessageKey() | translate: tokenMessageParams() }}
      </div>
    }
  `,
})
export class CloudStatusBadgesComponent {
  sync = input.required<SyncStaleness>()
  token = input.required<TokenExpiry>()

  // Inline-Pillen — Positioning macht der Stack-Container des Konsumenten.
  // Pillen-Optik identisch zu OFFLINE/RE-PAIRING in pos-client/app.ts.
  private readonly BASE_CLASSES =
    'flex items-center gap-1.5 px-3 py-1 ' +
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
