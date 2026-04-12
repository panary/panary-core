import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'

const LABEL = 'text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider'
const DAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

interface RegularHour {
  day: number
  open: string
  close: string
  closed: boolean
}

interface HourException {
  _id?: string
  date: string
  label: string
  closed: boolean
  open: string
  close: string
}

@Component({
  selector: 'app-opening-hours',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 max-w-2xl space-y-6 h-full overflow-y-auto">
      <div>
        <h1 class="text-xl font-bold tracking-tight">{{ 'OPENING_HOURS.TITLE' | translate }}</h1>
        <p class="text-slate-500 dark:text-gray-400 text-sm mt-1">{{ 'OPENING_HOURS.DESCRIPTION' | translate }}</p>
      </div>

      @if (loading()) {
        <p class="text-slate-400 dark:text-gray-500">{{ 'COMMON.LOADING' | translate }}</p>
      } @else {

        <!-- Toggle -->
        <div class="flex items-center justify-between border border-slate-200 dark:border-gray-800 rounded-xl p-4">
          <div>
            <p class="text-sm font-medium text-slate-900 dark:text-white">{{ 'OPENING_HOURS.ENABLED' | translate }}</p>
            <p class="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{{ 'OPENING_HOURS.ENABLED_HINT' | translate }}</p>
          </div>
          <button type="button" (click)="toggleEnabled()"
            [class]="enabled
              ? 'relative w-9 h-5 bg-slate-900 dark:bg-white rounded-full transition'
              : 'relative w-9 h-5 bg-slate-300 dark:bg-gray-700 rounded-full transition'">
            <span [class]="enabled
              ? 'absolute top-0.5 left-[18px] w-4 h-4 bg-white dark:bg-black rounded-full transition-all'
              : 'absolute top-0.5 left-0.5 w-4 h-4 bg-white dark:bg-black rounded-full transition-all'"></span>
          </button>
        </div>

        <!-- Reguläre Öffnungszeiten -->
        <div class="border border-slate-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
          <span class="${LABEL}">{{ 'OPENING_HOURS.REGULAR' | translate }}</span>

          @for (hour of regular; track hour.day) {
            <div class="flex items-center gap-3 py-1.5">
              <!-- Tag -->
              <span class="w-28 text-sm font-medium text-slate-700 dark:text-gray-300 shrink-0">{{ dayName(hour.day) }}</span>

              <!-- Geöffnet/Geschlossen Toggle -->
              <label class="flex items-center gap-2 cursor-pointer shrink-0">
                <input type="checkbox" [checked]="!hour.closed" (change)="hour.closed = !hour.closed; saveRegular()"
                  class="w-4 h-4 accent-slate-900 dark:accent-white" />
                <span class="text-xs text-slate-500 dark:text-gray-400 w-16">
                  {{ hour.closed ? ('OPENING_HOURS.CLOSED' | translate) : ('OPENING_HOURS.OPEN' | translate) }}
                </span>
              </label>

              <!-- Zeiten -->
              @if (!hour.closed) {
                <input type="time" [(ngModel)]="hour.open" [name]="'open-' + hour.day" (change)="saveRegular()"
                  class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg px-2 py-1.5 text-sm
                         text-slate-900 dark:text-white outline-none focus:border-slate-900 dark:focus:border-white" />
                <span class="text-slate-400 text-xs">—</span>
                <input type="time" [(ngModel)]="hour.close" [name]="'close-' + hour.day" (change)="saveRegular()"
                  class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg px-2 py-1.5 text-sm
                         text-slate-900 dark:text-white outline-none focus:border-slate-900 dark:focus:border-white" />
              }
            </div>
          }
        </div>

        <!-- Ausnahmen -->
        <div class="border border-slate-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
          <div class="flex items-center justify-between">
            <span class="${LABEL}">{{ 'OPENING_HOURS.EXCEPTIONS' | translate }}</span>
            <button type="button" (click)="addException()"
              class="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white
                     border border-slate-200 dark:border-gray-800 hover:border-slate-400 dark:hover:border-gray-600
                     px-3 py-1.5 rounded-lg transition">
              + {{ 'OPENING_HOURS.ADD_EXCEPTION' | translate }}
            </button>
          </div>

          @if (exceptions().length === 0) {
            <p class="text-slate-300 dark:text-gray-600 text-xs text-center py-4">{{ 'OPENING_HOURS.NO_EXCEPTIONS' | translate }}</p>
          } @else {
            @for (exc of exceptions(); track exc._id || $index) {
              <div class="flex items-center gap-3 py-1.5 border-t border-slate-100 dark:border-gray-800 first:border-0">
                <input type="date" [(ngModel)]="exc.date" [name]="'exc-date-' + $index" (change)="saveException(exc)"
                  class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg px-2 py-1.5 text-sm
                         text-slate-900 dark:text-white outline-none focus:border-slate-900 dark:focus:border-white" />
                <input type="text" [(ngModel)]="exc.label" [name]="'exc-label-' + $index" (change)="saveException(exc)"
                  placeholder="Bezeichnung" class="flex-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800
                         rounded-lg px-2 py-1.5 text-sm text-slate-900 dark:text-white outline-none
                         focus:border-slate-900 dark:focus:border-white" />
                <label class="flex items-center gap-1.5 cursor-pointer shrink-0">
                  <input type="checkbox" [checked]="exc.closed" (change)="exc.closed = !exc.closed; saveException(exc)"
                    class="w-4 h-4 accent-slate-900 dark:accent-white" />
                  <span class="text-xs text-slate-500 dark:text-gray-400">{{ 'OPENING_HOURS.CLOSED' | translate }}</span>
                </label>
                @if (!exc.closed) {
                  <input type="time" [(ngModel)]="exc.open" [name]="'exc-open-' + $index" (change)="saveException(exc)"
                    class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg px-2 py-1.5 text-sm
                           text-slate-900 dark:text-white outline-none" />
                  <span class="text-slate-400 text-xs">—</span>
                  <input type="time" [(ngModel)]="exc.close" [name]="'exc-close-' + $index" (change)="saveException(exc)"
                    class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg px-2 py-1.5 text-sm
                           text-slate-900 dark:text-white outline-none" />
                }
                <button type="button" (click)="removeException(exc)"
                  class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 dark:text-gray-500
                         hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition text-xs shrink-0">
                  ✕
                </button>
              </div>
            }
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
export class OpeningHoursComponent implements OnInit {
  private api = inject(ApiService)
  private t = inject(TranslateService)

  loading = signal(true)
  saving = signal(false)
  saved = signal(false)
  error = signal<string | null>(null)
  locationId = signal<string | null>(null)
  exceptions = signal<HourException[]>([])
  private currentSettings: any = {}

  enabled = false
  regular: RegularHour[] = []

  dayName(day: number): string {
    return DAY_NAMES[day] || ''
  }

  async ngOnInit() {
    try {
      const result = await this.api.find<any>('locations', { $limit: 1 })
      if (result.data.length > 0) {
        const loc = result.data[0]
        this.locationId.set(loc._id)
        this.currentSettings = loc.settings ?? {}
        const ohs = this.currentSettings.openingHoursSettings
        if (ohs) {
          this.enabled = ohs.enabled ?? false
          this.regular = ohs.regular ?? this.defaultRegular()
        } else {
          this.regular = this.defaultRegular()
        }
      }

      // Ausnahmen laden (nur zukünftige)
      const today = new Date().toISOString().slice(0, 10)
      const excResult = await this.api.find<any>('opening-hour-exceptions', {
        date: { $gte: today },
        $sort: { date: 1 },
        $limit: 100,
      })
      this.exceptions.set(excResult.data)
    } catch (e) {
      console.error('Fehler beim Laden der Öffnungszeiten:', e)
      this.error.set(this.t.instant('OPENING_HOURS.LOAD_ERROR'))
    }
    this.loading.set(false)
  }

  toggleEnabled() {
    this.enabled = !this.enabled
    this.saveRegular()
  }

  async saveRegular() {
    this.error.set(null)
    this.saved.set(false)
    try {
      const mergedSettings = {
        ...this.currentSettings,
        openingHoursSettings: {
          enabled: this.enabled,
          regular: this.regular,
        },
      }
      await this.api.patch('locations', this.locationId()!, { settings: mergedSettings })
      this.currentSettings = mergedSettings
      this.saved.set(true)
      setTimeout(() => this.saved.set(false), 2000)
    } catch (e: any) {
      this.error.set(formatApiError(e))
    }
  }

  addException() {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const dateStr = tomorrow.toISOString().slice(0, 10)
    this.createException({ date: dateStr, label: '', closed: true, open: '10:00', close: '22:00' })
  }

  async createException(exc: Omit<HourException, '_id'>) {
    try {
      const created = await this.api.create<any>('opening-hour-exceptions', exc)
      this.exceptions.update(list => [...list, created].sort((a, b) => a.date.localeCompare(b.date)))
    } catch (e: any) {
      this.error.set(formatApiError(e))
    }
  }

  async saveException(exc: HourException) {
    if (!exc._id) return
    try {
      await this.api.patch('opening-hour-exceptions', exc._id, {
        date: exc.date,
        label: exc.label,
        closed: exc.closed,
        open: exc.open,
        close: exc.close,
      })
    } catch (e: any) {
      this.error.set(formatApiError(e))
    }
  }

  async removeException(exc: HourException) {
    if (!exc._id) return
    try {
      await this.api.remove('opening-hour-exceptions', exc._id)
      this.exceptions.update(list => list.filter(e => e._id !== exc._id))
    } catch (e: any) {
      this.error.set(formatApiError(e))
    }
  }

  private defaultRegular(): RegularHour[] {
    return [
      { day: 0, open: '10:00', close: '22:00', closed: true },
      { day: 1, open: '10:00', close: '22:00', closed: false },
      { day: 2, open: '10:00', close: '22:00', closed: false },
      { day: 3, open: '10:00', close: '22:00', closed: false },
      { day: 4, open: '10:00', close: '22:00', closed: false },
      { day: 5, open: '10:00', close: '22:00', closed: false },
      { day: 6, open: '10:00', close: '22:00', closed: false },
    ]
  }
}
