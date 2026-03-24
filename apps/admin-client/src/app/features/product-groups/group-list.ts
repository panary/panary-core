import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core'
import { RouterLink } from '@angular/router'
import { ApiService } from '../../core/api.service'

interface ProductGroup {
  _id: string
  name: string
  acronym: string
  color: string
  index: number
  taxInside: number
  taxOutside: number
  excluded: boolean
  status: string
}

@Component({
  selector: 'app-group-list',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-8 space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold tracking-tight">Produktgruppen</h1>
        <a routerLink="/product-groups/new"
           class="bg-white text-black font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-gray-200 transition">
          + Neuer Eintrag
        </a>
      </div>

      @if (loading()) {
        <p class="text-gray-500">Laden...</p>
      } @else if (groups().length === 0) {
        <div class="text-center py-16">
          <p class="text-gray-500 text-lg">Keine Produktgruppen vorhanden</p>
          <p class="text-gray-600 text-sm mt-1">Erstelle die erste Produktgruppe</p>
        </div>
      } @else {
        <div class="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 text-left text-gray-500 text-xs uppercase tracking-wider">
                <th class="px-4 py-3">Farbe</th>
                <th class="px-4 py-3">Name</th>
                <th class="px-4 py-3">Kürzel</th>
                <th class="px-4 py-3">MwSt. Inhaus</th>
                <th class="px-4 py-3">MwSt. A. Haus</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              @for (group of groups(); track group._id) {
                <tr class="border-b border-gray-800/50 hover:bg-gray-800/30 transition">
                  <td class="px-4 py-3">
                    <span class="inline-block w-4 h-4 rounded-full border border-gray-700"
                          [style.background-color]="group.color"></span>
                  </td>
                  <td class="px-4 py-3 font-medium">{{ group.name }}</td>
                  <td class="px-4 py-3 text-gray-400 font-mono text-xs">{{ group.acronym }}</td>
                  <td class="px-4 py-3 text-gray-400">{{ group.taxInside }} %</td>
                  <td class="px-4 py-3 text-gray-400">{{ group.taxOutside }} %</td>
                  <td class="px-4 py-3">
                    <span [class]="group.status === 'ACTIVE' ? 'text-green-400' : 'text-gray-500'" class="text-xs">
                      {{ group.status }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <a [routerLink]="['/product-groups', group._id]"
                       class="text-gray-500 hover:text-white text-xs transition">Bearbeiten</a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class GroupListComponent implements OnInit {
  private api = inject(ApiService)

  groups = signal<ProductGroup[]>([])
  loading = signal(true)

  async ngOnInit() {
    try {
      const result = await this.api.find<ProductGroup>('product-groups', { $limit: 100 })
      this.groups.set(result.data)
    } catch (e) {
      console.error('Fehler beim Laden der Produktgruppen:', e)
    }
    this.loading.set(false)
  }
}
