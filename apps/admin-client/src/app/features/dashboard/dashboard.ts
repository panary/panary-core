import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core'
import { ApiService } from '../../core/api.service'

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-8 space-y-8">
      <h1 class="text-2xl font-bold tracking-tight">Dashboard</h1>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        @for (stat of stats(); track stat.label) {
          <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl p-6">
            <p class="text-slate-400 dark:text-gray-500 text-sm">{{ stat.label }}</p>
            <p class="text-3xl font-bold mt-1">{{ stat.value }}</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class DashboardComponent implements OnInit {
  private api = inject(ApiService)

  stats = signal([
    { label: 'Benutzer', value: '...' },
    { label: 'Standorte', value: '...' },
    { label: 'Produkte', value: '...' },
  ])

  async ngOnInit() {
    try {
      const [users, locations, products] = await Promise.all([
        this.api.find('users', { $limit: 0 }),
        this.api.find('locations', { $limit: 0 }),
        this.api.find('products', { $limit: 0 }),
      ])
      this.stats.set([
        { label: 'Benutzer', value: String(users.total) },
        { label: 'Standorte', value: String(locations.total) },
        { label: 'Produkte', value: String(products.total) },
      ])
    } catch {
      // Stats konnten nicht geladen werden
    }
  }
}
