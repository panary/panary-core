import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core'
import { DatePipe } from '@angular/common'
import { TranslateModule } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { CloudManagedBannerComponent } from '../../core/cloud-managed-banner'
import { CloudManagedService } from '../../core/cloud-managed.service'

// Lokales Interface (Konvention im admin-client, vgl. user-list/order-list) —
// Felder gemäß @panary/businessdays/domain business-day.schema.ts.
interface BusinessDay {
  _id: string
  date: string
  status: string
  operationMode: string
  locationId: string | null
  openedAt: string
  closedAt: string | null
  reportErrorMessage?: string | null
}

@Component({
  selector: 'app-business-days-list',
  standalone: true,
  imports: [TranslateModule, DatePipe, CloudManagedBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col h-full overflow-hidden">
      <div class="overflow-y-auto">
        <div class="p-6 space-y-4">
          <div class="min-h-9">
            <h1 class="text-xl font-bold tracking-tight">{{ 'BUSINESS_DAYS.TITLE' | translate }}</h1>
            <!-- Dreistufig: solange /health nicht geantwortet hat, ein Platzhalter
                 statt „Standalone", das gleich darauf auf „Cloud" umspringt. -->
            @if (!cloudManaged.stateKnown()) {
              <p class="text-xs text-slate-400 dark:text-gray-500 mt-1">&nbsp;</p>
            } @else {
              <p class="text-xs text-slate-400 dark:text-gray-500 mt-1">
                {{ (readOnly() ? 'BUSINESS_DAYS.SUBTITLE_CLOUD' : 'BUSINESS_DAYS.SUBTITLE_STANDALONE') | translate }}
              </p>
            }
          </div>

          @if (readOnly()) {
            <app-cloud-managed-banner sublineKey="CLOUD_MANAGED.SUBLINE_BUSINESS_DAYS" />
          }

          @if (hasStaleOpenDays()) {
            <div class="flex gap-3 items-start border border-amber-200 dark:border-amber-800/60
                        bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4">
              <span class="material-symbols-outlined text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                    style="font-size: 20px; line-height: 1" aria-hidden="true">warning</span>
              <div class="text-sm min-w-0 flex-1">
                <p class="font-medium text-amber-900 dark:text-amber-100">
                  {{ 'BUSINESS_DAYS.STALE_BANNER_TITLE' | translate: { count: staleOpenIds().size } }}
                </p>
                <p class="text-amber-800 dark:text-amber-200 mt-1">
                  {{ 'BUSINESS_DAYS.STALE_BANNER_BODY' | translate }}
                </p>
              </div>
            </div>
          }

          @if (loading()) {
            <p class="text-slate-400 dark:text-gray-500 text-sm">{{ 'COMMON.LOADING' | translate }}</p>
          } @else if (businessDays().length === 0) {
            <p class="text-slate-400 dark:text-gray-500 text-center py-12 text-sm">
              {{ 'BUSINESS_DAYS.NONE' | translate }}
            </p>
          } @else {
            <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-slate-200 dark:border-gray-800 text-left text-slate-400 dark:text-gray-500
                             text-xs uppercase tracking-wider">
                    <th class="px-3 py-2.5">{{ 'BUSINESS_DAYS.DATE' | translate }}</th>
                    <th class="px-3 py-2.5">{{ 'COMMON.STATUS' | translate }}</th>
                    <th class="px-3 py-2.5">{{ 'BUSINESS_DAYS.MODE' | translate }}</th>
                    <th class="px-3 py-2.5">{{ 'BUSINESS_DAYS.OPENED' | translate }}</th>
                    <th class="px-3 py-2.5">{{ 'BUSINESS_DAYS.CLOSED' | translate }}</th>
                    <th class="px-3 py-2.5">{{ 'BUSINESS_DAYS.REPORT' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (bd of businessDays(); track bd._id) {
                    <tr class="border-b border-slate-200/50 dark:border-gray-800/50"
                        [class.bg-amber-50/60]="staleOpenIds().has(bd._id)"
                        [class.dark:bg-amber-950/10]="staleOpenIds().has(bd._id)">
                      <td class="px-3 py-2.5 font-medium tabular-nums">{{ bd.date }}</td>
                      <td class="px-3 py-2.5">
                        <span class="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full ring-1 ring-inset"
                              [class]="statusBadgeClass(bd.status)">
                          {{ statusLabelKey(bd.status) | translate }}
                        </span>
                        @if (staleOpenIds().has(bd._id)) {
                          <span class="ml-1.5 inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full
                                       ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-600/20
                                       dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-500/30"
                                [title]="'BUSINESS_DAYS.STALE_OPEN_HINT' | translate">
                            &#9888; {{ 'BUSINESS_DAYS.STALE_OPEN' | translate }}
                          </span>
                        }
                      </td>
                      <td class="px-3 py-2.5 text-slate-500 dark:text-gray-400 text-xs">
                        {{ modeLabelKey(bd.operationMode) | translate }}
                      </td>
                      <td class="px-3 py-2.5 text-slate-500 dark:text-gray-400 text-xs tabular-nums">
                        {{ bd.openedAt ? (bd.openedAt | date: 'dd.MM.yyyy HH:mm') : '—' }}
                      </td>
                      <td class="px-3 py-2.5 text-slate-500 dark:text-gray-400 text-xs tabular-nums">
                        {{ bd.closedAt ? (bd.closedAt | date: 'dd.MM.yyyy HH:mm') : '—' }}
                      </td>
                      <td class="px-3 py-2.5 text-xs max-w-60">
                        @if (bd.reportErrorMessage) {
                          <span class="text-red-500 truncate inline-block max-w-full align-bottom"
                                [title]="bd.reportErrorMessage">⚠ {{ bd.reportErrorMessage }}</span>
                        } @else {
                          <span class="text-slate-400 dark:text-gray-600">—</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class BusinessDaysListComponent implements OnInit {
  private api = inject(ApiService)
  protected cloudManaged = inject(CloudManagedService)

  businessDays = signal<BusinessDay[]>([])
  loading = signal(true)

  /**
   * Solange der Edge gepairt ist, verwaltet die Cloud den Geschaeftstag-Lifecycle
   * (guardCloudManagedLifecycle). Bewusst unabhaengig von
   * `offlineOverrideActiveUntil`: das Override erlaubt nur die lokale Rotation,
   * NICHT externe Writes — die Seite darf also nicht editierbar wirken.
   */
  protected readOnly = this.cloudManaged.readOnly

  /**
   * Offene Tage, die es nicht mehr geben duerfte.
   *
   * Pro Filiale darf genau ein Tag offen sein (openDay-Guard). Mehrere offene
   * Tage derselben Filiale sind eine Anomalie — typisch nach abgebrochenem
   * Abschluss oder Zeiger-Drift. Der juengste gilt als der echte, alle aelteren
   * als verwaist.
   *
   * BEWUSST nach locationId gruppiert: ein Tenant mit mehreren Filialen hat
   * legitim mehrere offene Tage gleichzeitig, und TENANT_OWNER/-MANAGER sehen
   * ueber multiTenancy alle Filialen. Ohne Gruppierung gaebe es Fehlalarme.
   */
  staleOpenIds = computed<ReadonlySet<string>>(() => {
    const newestPerLocation = new Map<string, BusinessDay>()
    const stale = new Set<string>()

    for (const bd of this.businessDays()) {
      if (bd.status !== 'open') continue
      const key = bd.locationId ?? '__global__'
      const current = newestPerLocation.get(key)
      if (!current) {
        newestPerLocation.set(key, bd)
        continue
      }
      // `date` ist YYYY-MM-DD → lexikografischer Vergleich == chronologisch.
      const isNewer = bd.date > current.date
      newestPerLocation.set(key, isNewer ? bd : current)
      stale.add(isNewer ? current._id : bd._id)
    }

    return stale
  })

  hasStaleOpenDays = computed(() => this.staleOpenIds().size > 0)

  async ngOnInit() {
    // Frischen Cloud-Zustand holen statt bis zu 60 s auf den naechsten Poll zu
    // warten (Muster aus pager-settings/opening-hours).
    void this.cloudManaged.refresh()
    try {
      const result = await this.api.find<BusinessDay>('businessdays', { $sort: { date: -1 }, $limit: 200 })
      this.businessDays.set(result.data)
    } catch (e) {
      console.error('Fehler beim Laden der Geschäftstage:', e)
    }
    this.loading.set(false)
  }

  statusLabelKey(status: string): string {
    switch (status) {
      case 'open': return 'BUSINESS_DAYS.ST_OPEN'
      case 'closing-requested': return 'BUSINESS_DAYS.ST_CLOSING_REQUESTED'
      case 'closing-aggregating': return 'BUSINESS_DAYS.ST_CLOSING_AGGREGATING'
      case 'closed': return 'BUSINESS_DAYS.ST_CLOSED'
      case 'failed': return 'BUSINESS_DAYS.ST_FAILED'
      case 'audited': return 'BUSINESS_DAYS.ST_AUDITED'
      default: return status
    }
  }

  statusBadgeClass(status: string): string {
    switch (status) {
      case 'open':
        return 'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-900/30 dark:text-green-300'
      case 'closing-requested':
      case 'closing-aggregating':
        return 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-900/30 dark:text-amber-300'
      case 'closed':
        return 'bg-gray-100 text-gray-700 ring-gray-500/20 dark:bg-gray-800 dark:text-gray-300'
      case 'failed':
        return 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-900/30 dark:text-red-300'
      case 'audited':
        return 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-900/30 dark:text-blue-300'
      default:
        return 'bg-gray-100 text-gray-700 ring-gray-500/20'
    }
  }

  modeLabelKey(mode: string): string {
    return mode === 'pos-cashier' ? 'BUSINESS_DAYS.MODE_POS_CASHIER' : 'BUSINESS_DAYS.MODE_ORDERS_ONLY'
  }
}
