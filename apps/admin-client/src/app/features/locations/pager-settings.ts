import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'

const LABEL = 'text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider'

@Component({
  selector: 'app-pager-settings',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 max-w-2xl space-y-4 h-full overflow-y-auto">
      <div>
        <div class="flex items-center justify-between min-h-9">
          <h1 class="text-xl font-bold tracking-tight">{{ 'LOCATION.PAGER_SETTINGS' | translate }}</h1>
        </div>
        <p class="text-slate-500 dark:text-gray-400 text-sm mt-1 leading-relaxed">{{ 'LOCATION.PAGER_DESCRIPTION' | translate }}</p>
      </div>

      @if (loading()) {
        <p class="text-slate-400 dark:text-gray-500">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (!locationId()) {
        <div class="text-center py-16">
          <p class="text-slate-400 dark:text-gray-500 text-lg">{{ 'LOCATION.NO_LOCATION' | translate }}</p>
        </div>
      } @else {
        <!-- Toggle -->
        <div class="flex items-center justify-between border border-slate-200 dark:border-gray-800 rounded-xl p-4">
          <div>
            <p class="text-sm font-medium text-slate-900 dark:text-white">{{ 'LOCATION.PAGER_ENABLED' | translate }}</p>
            <p class="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{{ 'LOCATION.PAGER_ENABLED_HINT' | translate }}</p>
          </div>
          <button type="button" (click)="toggleEnabled()"
            [class]="pagerEnabled
              ? 'relative w-9 h-5 bg-slate-900 dark:bg-white rounded-full transition'
              : 'relative w-9 h-5 bg-slate-300 dark:bg-gray-700 rounded-full transition'">
            <span [class]="pagerEnabled
              ? 'absolute top-0.5 left-[18px] w-4 h-4 bg-white dark:bg-black rounded-full transition-all'
              : 'absolute top-0.5 left-0.5 w-4 h-4 bg-white dark:bg-black rounded-full transition-all'"></span>
          </button>
        </div>

        <!-- Pager hinzufügen -->
        <div class="border border-slate-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
          <span class="${LABEL}">{{ 'LOCATION.PAGER_LIST' | translate }}</span>

          <div class="flex items-center gap-2">
            <input [(ngModel)]="newPagerNumber" name="newPager" type="number" min="1"
              placeholder="{{ 'LOCATION.PAGER_NUMBER' | translate }}"
              (keydown.enter)="addPager(); $event.preventDefault()"
              class="flex-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800
                     rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none
                     focus:border-slate-900 dark:focus:border-white font-mono" />
            <button type="button" (click)="addPager()"
              class="px-4 py-2.5 text-sm font-medium bg-slate-900 dark:bg-white text-white dark:text-black
                     rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 transition">
              + {{ 'LOCATION.PAGER_ADD' | translate }}
            </button>
          </div>

          @if (pagerDuplicateError()) {
            <p class="text-red-400 text-xs">{{ 'LOCATION.PAGER_DUPLICATE' | translate }}</p>
          }

          <!-- Batch hinzufügen -->
          <div class="flex items-center gap-2">
            <input [(ngModel)]="batchCount" name="batchCount" type="number" min="1" max="100"
              placeholder="{{ 'LOCATION.PAGER_BATCH_PLACEHOLDER' | translate }}"
              (keydown.enter)="addBatch(); $event.preventDefault()"
              class="flex-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800
                     rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none
                     focus:border-slate-900 dark:focus:border-white font-mono" />
            <button type="button" (click)="addBatch()"
              class="px-4 py-2.5 text-sm font-medium text-slate-500 dark:text-gray-400
                     border border-slate-200 dark:border-gray-800 rounded-lg
                     hover:text-slate-900 dark:hover:text-white hover:border-slate-400
                     dark:hover:border-gray-600 transition whitespace-nowrap">
              {{ 'LOCATION.PAGER_BATCH_ADD' | translate }}
            </button>
          </div>

          @if (batchError()) {
            <p class="text-red-400 text-xs">{{ batchError() }}</p>
          }

          @if (pagers.length === 0) {
            <p class="text-slate-300 dark:text-gray-600 text-xs text-center py-6">{{ 'LOCATION.NO_PAGERS' | translate }}</p>
          } @else {
            <div class="flex flex-wrap gap-2">
              @for (p of pagers; track p) {
                <span class="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-gray-800
                             text-slate-700 dark:text-gray-300 text-sm font-mono
                             pl-3.5 pr-1.5 py-2 rounded-lg">
                  {{ p }}
                  <button type="button" (click)="removePager(p)"
                    class="w-7 h-7 flex items-center justify-center rounded-md
                           text-slate-400 dark:text-gray-500 hover:text-red-400
                           hover:bg-red-50 dark:hover:bg-red-900/20 transition text-xs">
                    ✕
                  </button>
                </span>
              }
            </div>
            <p class="text-xs text-slate-400 dark:text-gray-500">{{ pagers.length }} {{ 'LOCATION.PAGER_COUNT' | translate }}</p>
          }
        </div>

        @if (error()) {
          <p class="text-red-500 dark:text-red-400 text-sm">{{ error() }}</p>
        }

        @if (saved()) {
          <p class="text-green-600 dark:text-green-400 text-sm">{{ 'COMMON.SAVED' | translate }}</p>
        }
      }
    </div>
  `,
})
export class PagerSettingsComponent implements OnInit {
  private api = inject(ApiService)
  private t = inject(TranslateService)

  loading = signal(true)
  saving = signal(false)
  saved = signal(false)
  error = signal<string | null>(null)
  locationId = signal<string | null>(null)
  pagerDuplicateError = signal(false)
  batchError = signal<string | null>(null)

  pagerEnabled = false
  pagers: number[] = []
  newPagerNumber: number | null = null
  batchCount: number | null = null
  private currentSettings: any = {}

  private static readonly MAX_PAGERS = 200

  async ngOnInit() {
    try {
      const result = await this.api.find<any>('locations', { $limit: 1 })
      if (result.data.length > 0) {
        const loc = result.data[0]
        this.locationId.set(loc._id)
        this.currentSettings = loc.settings ?? {}
        const ps = this.currentSettings.pagerSettings
        if (ps) {
          this.pagerEnabled = ps.enabled ?? false
          this.pagers = (ps.pagers || []).filter((n: any) => typeof n === 'number').sort((a: number, b: number) => a - b)
        }
      }
    } catch (e) {
      console.error('Fehler beim Laden der Pager-Einstellungen:', e)
      this.error.set(this.t.instant('LOCATION.LOAD_ERROR'))
    }
    this.loading.set(false)
  }

  addPager() {
    const num = this.newPagerNumber
    if (num == null || num < 1) return
    this.pagerDuplicateError.set(false)

    if (this.pagers.length >= PagerSettingsComponent.MAX_PAGERS) {
      this.pagerDuplicateError.set(false)
      this.batchError.set(this.t.instant('LOCATION.PAGER_LIMIT', { max: PagerSettingsComponent.MAX_PAGERS }))
      return
    }

    if (this.pagers.includes(num)) {
      this.pagerDuplicateError.set(true)
      return
    }

    this.pagers = [...this.pagers, num].sort((a, b) => a - b)
    this.newPagerNumber = null
    this.batchError.set(null)
    this.savePagerSettings()
  }

  addBatch() {
    const count = this.batchCount
    this.batchError.set(null)
    this.pagerDuplicateError.set(false)

    if (count == null || count < 1) return

    if (count > 100) {
      this.batchError.set(this.t.instant('LOCATION.PAGER_BATCH_MAX'))
      return
    }

    const total = this.pagers.length + count
    if (total > PagerSettingsComponent.MAX_PAGERS) {
      this.batchError.set(this.t.instant('LOCATION.PAGER_LIMIT', { max: PagerSettingsComponent.MAX_PAGERS }))
      return
    }

    // Nächste freie Nummern finden (ab 1, Lücken füllen)
    const existing = new Set(this.pagers)
    const newPagers: number[] = []
    let candidate = 1
    while (newPagers.length < count) {
      if (!existing.has(candidate)) {
        newPagers.push(candidate)
      }
      candidate++
    }

    this.pagers = [...this.pagers, ...newPagers].sort((a, b) => a - b)
    this.batchCount = null
    this.savePagerSettings()
  }

  removePager(num: number) {
    this.pagers = this.pagers.filter(p => p !== num)
    this.savePagerSettings()
  }

  toggleEnabled() {
    this.pagerEnabled = !this.pagerEnabled
    this.savePagerSettings()
  }

  private async savePagerSettings() {
    this.saving.set(true)
    this.error.set(null)
    this.saved.set(false)
    try {
      const mergedSettings = {
        ...this.currentSettings,
        pagerSettings: {
          enabled: this.pagerEnabled,
          pagers: this.pagers,
        },
      }
      await this.api.patch('locations', this.locationId()!, { settings: mergedSettings })
      this.currentSettings = mergedSettings
      this.saved.set(true)
      setTimeout(() => this.saved.set(false), 2000)
    } catch (e: any) {
      this.error.set(formatApiError(e))
    }
    this.saving.set(false)
  }
}
