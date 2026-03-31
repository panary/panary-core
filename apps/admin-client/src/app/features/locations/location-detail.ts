import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'
import { LocationStateService } from '../../core/location-state.service'

@Component({
  selector: 'app-location-detail',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 max-w-2xl space-y-4 h-full overflow-y-auto">
      <div>
        <div class="flex items-center justify-between min-h-9">
          <h1 class="text-xl font-bold tracking-tight">Standort</h1>
        </div>
        <p class="text-slate-500 dark:text-gray-400 text-sm mt-1 leading-relaxed">Standortdaten und Kontaktinformationen dieses Edge-Servers.</p>
      </div>

      @if (loading()) {
        <p class="text-slate-400 dark:text-gray-500">Laden...</p>
      } @else if (!locationId()) {
        <div class="text-center py-16">
          <p class="text-slate-400 dark:text-gray-500 text-lg">Kein Standort vorhanden</p>
          <p class="text-slate-400 dark:text-gray-500 text-sm mt-1">Der Standort wird beim ersten Setup automatisch erstellt.</p>
        </div>
      } @else {
        <form (ngSubmit)="onSave()" class="space-y-4">
          <!-- Name -->
          <div class="space-y-1.5">
            <label for="locationName" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Name *</label>
            <input id="locationName" [(ngModel)]="form.name" name="name" type="text" required
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-3 text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none text-sm" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <!-- E-Mail -->
            <div class="space-y-1.5">
              <label for="locationEmail" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">E-Mail</label>
              <input id="locationEmail" [(ngModel)]="form.email" name="email" type="email"
                class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-3 text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none text-sm" />
            </div>
            <!-- Telefon -->
            <div class="space-y-1.5">
              <label for="locationPhone" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Telefon</label>
              <input id="locationPhone" [(ngModel)]="form.phone" name="phone" type="text"
                class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-3 text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none text-sm" />
            </div>
          </div>

          <!-- Status -->
          <div class="space-y-1.5">
            <label for="locationStatus" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Status</label>
            <select id="locationStatus" [(ngModel)]="form.status" name="status"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-3 text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none text-sm">
              <option value="DRAFT">Entwurf</option>
              <option value="ACTIVE">Aktiv</option>
            </select>
          </div>

          @if (error()) {
            <p class="text-red-500 dark:text-red-400 text-sm">{{ error() }}</p>
          }

          @if (saved()) {
            <p class="text-green-600 dark:text-green-400 text-sm">Gespeichert.</p>
          }

          <button type="submit" [disabled]="saving()"
            class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-6 py-3 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition disabled:opacity-50">
            {{ saving() ? 'Speichern...' : 'Speichern' }}
          </button>
        </form>
      }
    </div>
  `,
})
export class LocationDetailComponent implements OnInit {
  private api = inject(ApiService)
  private locationState = inject(LocationStateService)

  loading = signal(true)
  saving = signal(false)
  saved = signal(false)
  error = signal<string | null>(null)
  locationId = signal<string | null>(null)

  form = { name: '', email: '', phone: '', status: 'ACTIVE' }

  async ngOnInit() {
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
      this.error.set('Standort konnte nicht geladen werden.')
    }
    this.loading.set(false)
  }

  async onSave() {
    if (!this.form.name) {
      this.error.set('Name ist erforderlich')
      return
    }
    this.saving.set(true)
    this.error.set(null)
    this.saved.set(false)
    try {
      await this.api.patch('locations', this.locationId()!, this.form)
      this.locationState.locationName.set(this.form.name)
      this.saved.set(true)
    } catch (e: any) {
      this.error.set(formatApiError(e))
    }
    this.saving.set(false)
  }
}
