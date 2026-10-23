import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core'
import { DatePipe } from '@angular/common'
import { TranslateModule } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { CloudManagedBannerComponent } from '../../core/cloud-managed-banner'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'
import { formatApiError } from '../../core/error-helper'
import { AdminIconComponent } from '../../shared/icon/icon'
import { findStaleOpenDayIds } from './stale-open-days'

// Lokales Interface (Konvention im admin-client, vgl. user-list/order-list) —
// Felder gemäß @panary/businessdays/domain business-day.schema.ts.
interface BusinessDay {
  _id: string
  date: string
  status: string
  operationMode: string
  locationId: string | null
  openedAt: string
  openedBy?: string | null
  closedAt: string | null
  reportErrorMessage?: string | null
}

/** Ausschnitt einer Filiale: nur der Zeiger auf den aktuellen Geschaeftstag. */
interface LocationPointer {
  currentBusinessDay?: { businessDayId: string } | null
}

@Component({
  selector: 'app-business-days-list',
  standalone: true,
  imports: [TranslateModule, DatePipe, CloudManagedBannerComponent, ConfirmDialogComponent, AdminIconComponent],
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
              <p class="text-xs text-ink-faint mt-1">&nbsp;</p>
            } @else {
              <p class="text-xs text-ink-faint mt-1">
                {{ (readOnly() ? 'BUSINESS_DAYS.SUBTITLE_CLOUD' : 'BUSINESS_DAYS.SUBTITLE_STANDALONE') | translate }}
              </p>
            }
          </div>

          @if (readOnly()) {
            <app-cloud-managed-banner sublineKey="CLOUD_MANAGED.SUBLINE_BUSINESS_DAYS" />
          }

          @if (hasStaleOpenDays()) {
            <div
              class="flex gap-3 items-start border border-amber-200 dark:border-amber-800/60
                        bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4"
            >
              <app-icon name="warning" class="text-[20px] text-amber-600 dark:text-amber-400 mt-0.5" />
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

          @if (actionError()) {
            <div class="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded-lg p-4">
              <p class="text-red-600 dark:text-red-400 text-sm">{{ actionError() }}</p>
            </div>
          }

          @if (loading()) {
            <p class="text-ink-faint text-sm">{{ 'COMMON.LOADING' | translate }}</p>
          } @else if (businessDays().length === 0) {
            <p class="text-ink-faint text-center py-12 text-sm">
              {{ 'BUSINESS_DAYS.NONE' | translate }}
            </p>
          } @else {
            <div class="admin-table-wrap">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>{{ 'BUSINESS_DAYS.DATE' | translate }}</th>
                    <th>{{ 'COMMON.STATUS' | translate }}</th>
                    <th>{{ 'BUSINESS_DAYS.MODE' | translate }}</th>
                    <th>{{ 'BUSINESS_DAYS.OPENED' | translate }}</th>
                    <th>{{ 'BUSINESS_DAYS.CLOSED' | translate }}</th>
                    <th>{{ 'BUSINESS_DAYS.REPORT' | translate }}</th>
                    <th class="text-right">{{ 'COMMON.ACTIONS' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (bd of businessDays(); track bd._id) {
                    <tr
                      [class.bg-amber-50/60]="staleOpenIds().has(bd._id)"
                      [class.dark:bg-amber-950/10]="staleOpenIds().has(bd._id)"
                    >
                      <td class="font-medium tabular-nums">{{ bd.date }}</td>
                      <td>
                        <span
                          class="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full ring-1 ring-inset"
                          [class]="statusBadgeClass(bd.status)"
                        >
                          {{ statusLabelKey(bd.status) | translate }}
                        </span>
                        @if (staleOpenIds().has(bd._id)) {
                          <span
                            class="ml-1.5 inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full
                                       ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-600/20
                                       dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-500/30"
                            [title]="'BUSINESS_DAYS.STALE_OPEN_HINT' | translate"
                          >
                            &#9888; {{ 'BUSINESS_DAYS.STALE_OPEN' | translate }}
                          </span>
                        }
                      </td>
                      <td class="text-ink-muted text-xs">
                        {{ modeLabelKey(bd.operationMode) | translate }}
                      </td>
                      <td class="text-ink-muted text-xs tabular-nums">
                        {{ bd.openedAt ? (bd.openedAt | date: 'dd.MM.yyyy HH:mm') : '—' }}
                      </td>
                      <td class="text-ink-muted text-xs tabular-nums">
                        {{ bd.closedAt ? (bd.closedAt | date: 'dd.MM.yyyy HH:mm') : '—' }}
                      </td>
                      <td class="text-xs max-w-60">
                        @if (bd.reportErrorMessage) {
                          <span
                            class="text-red-500 truncate inline-block max-w-full align-bottom"
                            [title]="bd.reportErrorMessage"
                            >⚠ {{ bd.reportErrorMessage }}</span
                          >
                        } @else {
                          <span class="text-ink-faint">—</span>
                        }
                      </td>
                      <td class="text-right whitespace-nowrap">
                        <!-- Nur wo das Verwerfen auch durchgeht: der Backend-Guard
                             ist die Wahrheit, aber ein Knopf, der garantiert in eine
                             Fehlermeldung laeuft, ist schlimmer als kein Knopf. -->
                        @if (discardableIds().has(bd._id)) {
                          <button
                            type="button"
                            (click)="pendingDiscard.set(bd)"
                            [disabled]="discarding() === bd._id"
                            class="text-xs px-2.5 py-1 rounded-lg text-amber-700 dark:text-amber-400
                                   hover:bg-amber-100 dark:hover:bg-amber-950/40 transition disabled:opacity-50"
                          >
                            {{ 'BUSINESS_DAYS.DISCARD_ACTION' | translate }}
                          </button>
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

      @if (pendingDiscard(); as bd) {
        <app-confirm-dialog
          [title]="'BUSINESS_DAYS.DISCARD_TITLE' | translate"
          [message]="'BUSINESS_DAYS.DISCARD_CONFIRM' | translate: { date: bd.date }"
          [confirmLabel]="'BUSINESS_DAYS.DISCARD_ACTION' | translate"
          [dismissLabel]="'COMMON.CANCEL' | translate"
          (confirmed)="confirmDiscard()"
          (dismissed)="pendingDiscard.set(null)"
          (cancelled)="pendingDiscard.set(null)"
        />
      }
    </div>
  `,
})
export class BusinessDaysListComponent implements OnInit {
  private api = inject(ApiService)
  protected cloudManaged = inject(CloudManagedService)

  businessDays = signal<BusinessDay[]>([])
  loading = signal(true)
  pendingDiscard = signal<BusinessDay | null>(null)
  discarding = signal<string | null>(null)
  actionError = signal<string | null>(null)

  /**
   * Solange der Edge gepairt ist, verwaltet die Cloud den Geschaeftstag-Lifecycle
   * (guardCloudManagedLifecycle). Bewusst unabhaengig von
   * `offlineOverrideActiveUntil`: das Override erlaubt nur die lokale Rotation,
   * NICHT externe Writes — die Seite darf also nicht editierbar wirken.
   */
  protected readOnly = this.cloudManaged.readOnly

  /** `locations.currentBusinessDay.businessDayId` je Filiale — der Tag dort ist nie verwaist (core#737). */
  private readonly currentDayIds = signal<ReadonlySet<string>>(new Set())

  /** Verwaiste offene Tage — Regeln in `findStaleOpenDayIds`. */
  staleOpenIds = computed<ReadonlySet<string>>(() => findStaleOpenDayIds(this.businessDays(), this.currentDayIds()))

  hasStaleOpenDays = computed(() => this.staleOpenIds().size > 0)

  /**
   * Teilmenge der verwaisten Tage, die `discardOrphanDay` auch tatsaechlich
   * verwirft — gespiegelt an dessen Guard: `openedBy == null`.
   *
   * `rotateBusinessDay` sendet kein `openedBy`, `openDay()` setzt `user._id`.
   * Ein manuell eroeffneter Tag ist also anomal (Badge bleibt), aber kein
   * Auto-Rotations-Verwaister — er gehoert regulaer abgeschlossen, nicht
   * verworfen. Die restlichen Guards (Umsatz, aktueller Tag) kann der Client
   * nicht vorwegnehmen; die pruefft weiterhin nur das Backend.
   */
  discardableIds = computed<ReadonlySet<string>>(() => {
    const byId = new Map(this.businessDays().map(bd => [bd._id, bd]))
    return new Set([...this.staleOpenIds()].filter(id => !byId.get(id)?.openedBy))
  })

  async ngOnInit() {
    // Frischen Cloud-Zustand holen statt bis zu 60 s auf den naechsten Poll zu
    // warten (Muster aus pager-settings/opening-hours).
    void this.cloudManaged.refresh()
    await this.load()
    this.loading.set(false)
  }

  private async load() {
    try {
      const [result, locations] = await Promise.all([
        this.api.find<BusinessDay>('businessdays', { $sort: { date: -1 }, $limit: 200 }),
        // Best effort: ohne Zeiger greift der Datums-/openedAt-Vergleich, die Liste bleibt sichtbar.
        this.api
          .find<LocationPointer>('locations', { $select: ['_id', 'currentBusinessDay'], $limit: 200 })
          .catch(() => ({ data: [] as LocationPointer[] })),
      ])
      this.currentDayIds.set(
        new Set(
          locations.data.flatMap(l =>
            l.currentBusinessDay?.businessDayId ? [l.currentBusinessDay.businessDayId] : [],
          ),
        ),
      )
      this.businessDays.set(result.data)
    } catch (e) {
      console.error('Fehler beim Laden der Geschäftstage:', e)
    }
  }

  /**
   * Verwirft einen verwaisten Tag. Die Bedingungen prueft ausschliesslich das
   * Backend (sieben Guards in discardOrphanDay) — die Fehlermeldung von dort
   * wird unveraendert angezeigt, statt sie im UI vorwegzunehmen.
   */
  protected async confirmDiscard() {
    const bd = this.pendingDiscard()
    this.pendingDiscard.set(null)
    if (!bd) return

    this.actionError.set(null)
    this.discarding.set(bd._id)
    try {
      await this.api.customMethod('businessdays', 'discardOrphanDay', { businessDayId: bd._id })
      await this.load()
    } catch (e: unknown) {
      this.actionError.set(formatApiError(e))
    }
    this.discarding.set(null)
  }

  statusLabelKey(status: string): string {
    switch (status) {
      case 'open':
        return 'BUSINESS_DAYS.ST_OPEN'
      case 'closing-requested':
        return 'BUSINESS_DAYS.ST_CLOSING_REQUESTED'
      case 'closing-aggregating':
        return 'BUSINESS_DAYS.ST_CLOSING_AGGREGATING'
      case 'closed':
        return 'BUSINESS_DAYS.ST_CLOSED'
      case 'failed':
        return 'BUSINESS_DAYS.ST_FAILED'
      case 'audited':
        return 'BUSINESS_DAYS.ST_AUDITED'
      default:
        return status
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
        return 'bg-line-soft text-ink ring-ink-muted/20'
      case 'failed':
        return 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-900/30 dark:text-red-300'
      case 'audited':
        return 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-900/30 dark:text-blue-300'
      default:
        return 'bg-line-soft text-ink ring-ink-muted/20'
    }
  }

  modeLabelKey(mode: string): string {
    return mode === 'pos-cashier' ? 'BUSINESS_DAYS.MODE_POS_CASHIER' : 'BUSINESS_DAYS.MODE_ORDERS_ONLY'
  }
}
