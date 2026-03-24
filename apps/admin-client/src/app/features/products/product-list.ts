import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core'
import { RouterLink } from '@angular/router'
import { ApiService } from '../../core/api.service'

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-8 space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold tracking-tight">Produkte</h1>
        <a routerLink="/products/new"
           class="bg-white text-black font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-gray-200 transition">
          + Neues Produkt
        </a>
      </div>

      @if (products().length === 0 && !loading()) {
        <p class="text-gray-500 text-center py-16">Keine Produkte vorhanden</p>
      } @else {
        <div class="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 text-left text-gray-500 text-xs uppercase tracking-wider">
                <th class="px-4 py-3">Name</th>
                <th class="px-4 py-3">Kürzel</th>
                <th class="px-4 py-3">Preis</th>
                <th class="px-4 py-3">Typ</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              @for (p of products(); track p._id) {
                <tr class="border-b border-gray-800/50 hover:bg-gray-800/30 transition">
                  <td class="px-4 py-3 font-medium">{{ p.name }}</td>
                  <td class="px-4 py-3 text-gray-400 font-mono text-xs">{{ p.acronym }}</td>
                  <td class="px-4 py-3 font-mono">{{ (p.price || 0).toFixed(2) }} &euro;</td>
                  <td class="px-4 py-3">
                    <span class="text-xs px-2 py-0.5 rounded-full border border-gray-700 text-gray-300">
                      {{ p.productType || 'PRODUCT' }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span [class]="p.status === 'ACTIVE' ? 'text-green-400' : 'text-gray-500'" class="text-xs">
                      {{ p.status }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <a [routerLink]="['/products', p._id]"
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
export class ProductListComponent implements OnInit {
  private api = inject(ApiService)
  products = signal<any[]>([])
  loading = signal(true)

  async ngOnInit() {
    try {
      const result = await this.api.find<any>('products', { $limit: 100 })
      this.products.set(result.data)
    } catch (e) {
      console.error('Fehler beim Laden der Produkte:', e)
    }
    this.loading.set(false)
  }
}
