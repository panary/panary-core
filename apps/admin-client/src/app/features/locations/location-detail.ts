import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'

@Component({
  selector: 'app-location-detail',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-8 max-w-2xl space-y-6">
      <h1 class="text-2xl font-bold tracking-tight">Standort</h1>

      @if (loading()) {
        <p class="text-slate-400 dark:text-gray-500">Laden...</p>
      } @else if (!locationId()) {
        <div class="text-center py-16">
          <p class="text-slate-400 dark:text-gray-500 text-lg">Kein Standort vorhanden</p>
          <p class="text-slate-400 dark:text-gray-600 text-sm mt-1">Der Standort wird beim ersten Setup automatisch erstellt.</p>
        </div>
      } @else {
        <form (ngSubmit)="onSave()" class="space-y-5">
          <!-- Name -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Name *</label>
            <input [(ngModel)]="form.name" name="name" type="text" required
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <!-- E-Mail -->
            <div class="space-y-1">
              <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">E-Mail</label>
              <input [(ngModel)]="form.email" name="email" type="email"
                class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                       text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                       focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
            </div>
            <!-- Telefon -->
            <div class="space-y-1">
              <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Telefon</label>
              <input [(ngModel)]="form.phone" name="phone" type="text"
                class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                       text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                       focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
            </div>
          </div>

          <!-- Status -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Status</label>
            <select [(ngModel)]="form.status" name="status"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white outline-none">
              <option value="DRAFT">Entwurf</option>
              <option value="ACTIVE">Aktiv</option>
            </select>
          </div>

          @if (error()) {
            <p class="text-red-500 dark:text-red-400 text-sm">{{ error() }}</p>
          }

          @if (saved()) {
            <p class="text-green-500 dark:text-green-400 text-sm">Gespeichert.</p>
          }

          <div class="flex gap-3 pt-4">
            <button type="submit" [disabled]="saving()"
              class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-8 py-3 rounded-xl text-sm
                     hover:bg-slate-800 dark:hover:bg-gray-200 transition disabled:opacity-50">
              {{ saving() ? 'Speichern...' : 'Speichern' }}
            </button>
          </div>
        </form>
      }
    </div>
  `,
})
export class LocationDetailComponent implements OnInit {
  private api = inject(ApiService)

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
      this.saved.set(true)
    } catch (e: any) {
      this.error.set(formatApiError(e))
    }
    this.saving.set(false)
  }
}
