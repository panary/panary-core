import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { CloudManagedBannerComponent } from '../../core/cloud-managed-banner'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { formatApiError, getApiErrorCode } from '../../core/error-helper'
import { LocationStateService } from '../../core/location-state.service'

const LABEL = 'text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider'
const INPUT = `w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-3
               text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
               focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none text-sm`

@Component({
  selector: 'app-location-detail',
  standalone: true,
  imports: [FormsModule, TranslateModule, CloudManagedBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 max-w-2xl space-y-4 h-full overflow-y-auto">
      <div>
        <div class="flex items-center justify-between min-h-9">
          <h1 class="text-xl font-bold tracking-tight">{{ 'LOCATION.TITLE' | translate }}</h1>
        </div>
        <p class="text-slate-500 dark:text-gray-400 text-sm mt-1 leading-relaxed">{{ 'LOCATION.DESCRIPTION' | translate }}</p>
      </div>

      @if (loading()) {
        <p class="text-slate-400 dark:text-gray-500">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (!locationId()) {
        <div class="text-center py-16">
          <p class="text-slate-400 dark:text-gray-500 text-lg">{{ 'LOCATION.NO_LOCATION' | translate }}</p>
          <p class="text-slate-400 dark:text-gray-500 text-sm mt-1">{{ 'LOCATION.AUTO_CREATED' | translate }}</p>
        </div>
      } @else {
        @if (readOnly()) {
          <app-cloud-managed-banner sublineKey="CLOUD_MANAGED.SUBLINE_LOCATION" />
        }

        <form (ngSubmit)="onSave()" class="space-y-4">
          <!--
            fieldset[disabled] sperrt alle Controls nativ und nimmt sie aus der
            Tab-Reihenfolge. min-w-0, m-0, p-0 und border-0 neutralisieren die
            UA-Defaults, damit das Layout unveraendert bleibt.
          -->
          <fieldset [disabled]="readOnly()" class="min-w-0 m-0 p-0 border-0 space-y-4"
                    [class.opacity-60]="readOnly()">
          <!-- Name -->
          <div class="space-y-1.5">
            <label for="locationName" class="${LABEL}">{{ 'COMMON.NAME' | translate }} *</label>
            <input id="locationName" [(ngModel)]="form.name" name="name" type="text" required class="${INPUT}" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <!-- E-Mail -->
            <div class="space-y-1.5">
              <label for="locationEmail" class="${LABEL}">{{ 'USERS.EMAIL' | translate }}</label>
              <input id="locationEmail" [(ngModel)]="form.email" name="email" type="email" class="${INPUT}" />
            </div>
            <!-- Telefon -->
            <div class="space-y-1.5">
              <label for="locationPhone" class="${LABEL}">{{ 'LOCATION.PHONE' | translate }}</label>
              <input id="locationPhone" [(ngModel)]="form.phone" name="phone" type="text" class="${INPUT}" />
            </div>
          </div>

          <!-- Status -->
          <div class="space-y-1.5">
            <label for="locationStatus" class="${LABEL}">{{ 'COMMON.STATUS' | translate }}</label>
            <select id="locationStatus" [(ngModel)]="form.status" name="status" class="${INPUT}">
              <option value="DRAFT">{{ 'COMMON.STATUS_DRAFT' | translate }}</option>
              <option value="ACTIVE">{{ 'COMMON.STATUS_ACTIVE' | translate }}</option>
            </select>
          </div>
          </fieldset>

          @if (error()) {
            <p class="text-red-500 dark:text-red-400 text-sm">{{ error() }}</p>
          }

          @if (saved()) {
            <p class="text-green-600 dark:text-green-400 text-sm">{{ 'COMMON.SAVED' | translate }}</p>
          }

          <button type="submit" [disabled]="saving() || readOnly()"
            class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-6 py-3 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition disabled:opacity-50">
            {{ saving() ? ('COMMON.SAVING' | translate) : ('COMMON.SAVE' | translate) }}
          </button>
        </form>
      }
    </div>
  `,
})
export class LocationDetailComponent implements OnInit {
  private api = inject(ApiService)
  private locationState = inject(LocationStateService)
  private t = inject(TranslateService)
  private cloudManaged = inject(CloudManagedService)

  /** Cloud ist Source of Truth für Standort-Stammdaten, sobald gepairt. */
  protected readOnly = this.cloudManaged.readOnly

  loading = signal(true)
  saving = signal(false)
  saved = signal(false)
  error = signal<string | null>(null)
  locationId = signal<string | null>(null)

  form = { name: '', email: '', phone: '', status: 'ACTIVE' }

  async ngOnInit() {
    // Frischen Cloud-Zustand holen, statt auf den nächsten 60-s-Poll zu warten.
    void this.cloudManaged.refresh()
    try {
      const result = await this.api.find<any>('locations', { $limit: 1 })
      if (result.data.length > 0) {
        const loc = result.data[0]
        this.locationId.set(loc._id)
        this.form = {
          name: loc.name || '',
          email: loc.email || '',
          phone: loc.phone || '',
          status: loc.status || 'ACTIVE',
        }
      }
    } catch (e) {
      console.error('Fehler beim Laden des Standorts:', e)
      this.error.set(this.t.instant('LOCATION.LOAD_ERROR'))
    }
    this.loading.set(false)
  }

  async onSave() {
    // Letzte Verteidigungslinie vor dem Backend — das fieldset sperrt die
    // Eingabe, dieser Guard jeden programmatischen Pfad (z.B. Enter im
    // Formular nach einem Pairing-Wechsel mitten in der Sitzung).
    if (this.readOnly()) {
      this.error.set(this.t.instant('CLOUD_MANAGED.SAVE_BLOCKED'))
      return
    }
    if (!this.form.name) {
      this.error.set(this.t.instant('LOCATION.NAME_REQUIRED'))
      return
    }
    this.saving.set(true)
    this.error.set(null)
    this.saved.set(false)
    try {
      // Leere Optional-Felder NICHT mitsenden — sonst schlaegt das Schema-
      // Validate (`format: 'email'` etc.) auf einen leeren String an. Nur
      // tatsaechlich vom User eingegebene Werte patchen.
      const payload: Record<string, unknown> = {
        name: this.form.name,
        status: this.form.status,
      }
      if (this.form.email) payload['email'] = this.form.email
      if (this.form.phone) payload['phone'] = this.form.phone
      await this.api.patch('locations', this.locationId()!, payload)
      this.locationState.locationName.set(this.form.name)
      this.saved.set(true)
    } catch (e: unknown) {
      this.error.set(formatApiError(e))
      // Nach 403 CLOUD_MANAGED war der lokale Zustand nachweislich veraltet.
      if (getApiErrorCode(e) === 'CLOUD_MANAGED') void this.cloudManaged.refresh()
    }
    this.saving.set(false)
  }
}
