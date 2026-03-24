import { ChangeDetectionStrategy, Component, inject, signal, OnInit, input } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'

interface ProductGroup {
  _id: string
  name: string
  color: string
}

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-8 max-w-2xl space-y-6">
      <h1 class="text-2xl font-bold tracking-tight">{{ isNew() ? 'Neues Produkt' : 'Produkt bearbeiten' }}</h1>

      @if (!isNew()) {
        <div class="bg-gray-900/50 border border-gray-800 rounded-lg p-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <div>
            <span class="text-gray-500">ID</span>
            <p class="text-gray-300 font-mono mt-0.5 select-all">{{ entityId() }}</p>
          </div>
          <div>
            <span class="text-gray-500">External ID</span>
            <p class="text-gray-300 font-mono mt-0.5 select-all">{{ externalId() || '—' }}</p>
          </div>
        </div>
      }

      <form (ngSubmit)="onSave()" class="space-y-5">
        <div class="grid grid-cols-3 gap-4">
          <div class="col-span-2 space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Name *</label>
            <input [(ngModel)]="form.name" name="name" type="text" required
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                     focus:border-white focus:ring-1 focus:ring-white outline-none" />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Kürzel *</label>
            <input [(ngModel)]="form.acronym" name="acronym" type="text" required maxlength="10"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                     focus:border-white focus:ring-1 focus:ring-white outline-none font-mono" />
          </div>
        </div>

        <div class="grid grid-cols-3 gap-4">
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Preis (&euro;) *</label>
            <input [(ngModel)]="form.price" name="price" type="number" step="0.01" min="0"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                     focus:border-white focus:ring-1 focus:ring-white outline-none font-mono" />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">MwSt. Inhaus (%)</label>
            <input [(ngModel)]="form.taxInside" name="taxInside" type="number" step="0.1"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                     focus:border-white focus:ring-1 focus:ring-white outline-none font-mono" />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">MwSt. Außer Haus (%)</label>
            <input [(ngModel)]="form.taxOutside" name="taxOutside" type="number" step="0.1"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                     focus:border-white focus:ring-1 focus:ring-white outline-none font-mono" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Typ</label>
            <select [(ngModel)]="form.productType" name="productType"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white outline-none">
              <option value="PRODUCT">Produkt</option>
              <option value="MODIFIER">Modifier / Extra</option>
              <option value="BUNDLE">Menü / Bundle</option>
            </select>
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Status</label>
            <select [(ngModel)]="form.status" name="status"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white outline-none">
              <option value="DRAFT">Entwurf</option>
              <option value="ACTIVE">Aktiv</option>
              <option value="ARCHIVED">Archiviert</option>
            </select>
          </div>
        </div>

        <div class="space-y-1">
          <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Beschreibung</label>
          <textarea [(ngModel)]="form.description" name="description" rows="3"
            class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                   focus:border-white focus:ring-1 focus:ring-white outline-none resize-none"></textarea>
        </div>

        <!-- Produktgruppen -->
        @if (productGroups().length > 0) {
          <div class="space-y-2">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Produktgruppen</label>
            <div class="bg-gray-900/50 border border-gray-800 rounded-lg p-4 grid grid-cols-2 gap-2">
              @for (group of productGroups(); track group._id) {
                <label class="flex items-center gap-2 cursor-pointer hover:text-white transition text-gray-300 text-sm">
                  <input type="checkbox" [value]="group._id" [checked]="form.categoryIds.includes(group._id)"
                    (change)="toggleCategory(group._id, $event)"
                    class="w-4 h-4 accent-white" />
                  <span class="inline-block w-3 h-3 rounded-full shrink-0 border border-gray-700"
                        [style.background-color]="group.color"></span>
                  {{ group.name }}
                </label>
              }
            </div>
          </div>
        }

        @if (error()) {
          <p class="text-red-400 text-sm">{{ error() }}</p>
        }

        <div class="flex gap-3 pt-4">
          <button type="submit" [disabled]="saving()"
            class="bg-white text-black font-bold px-8 py-3 rounded-xl text-sm hover:bg-gray-200 transition
                   disabled:opacity-50">
            {{ saving() ? 'Speichern...' : 'Speichern' }}
          </button>
          <button type="button" (click)="router.navigate(['/products'])"
            class="bg-gray-900 border border-gray-800 text-gray-300 px-6 py-3 rounded-xl text-sm hover:bg-gray-800 transition">
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  `,
})
export class ProductFormComponent implements OnInit {
  private api = inject(ApiService)
  router = inject(Router)

  id = input<string>()
  isNew = signal(true)
  saving = signal(false)
  error = signal<string | null>(null)
  productGroups = signal<ProductGroup[]>([])
  entityId = signal<string>('')
  externalId = signal<string | null>(null)

  form = {
    name: '',
    acronym: '',
    price: 0,
    taxInside: 19,
    taxOutside: 7,
    productType: 'PRODUCT',
    status: 'ACTIVE',
    description: '',
    categoryIds: [] as string[],
  }

  async ngOnInit() {
    try {
      const result = await this.api.find<ProductGroup>('product-groups', { $limit: 100 })
      this.productGroups.set(result.data)
    } catch (e) {
      console.error('Fehler beim Laden der Produktgruppen:', e)
    }

    const prodId = this.id()
    if (prodId && prodId !== 'new') {
      this.isNew.set(false)
      try {
        const p = await this.api.get<any>('products', prodId)
        this.entityId.set(p._id || '')
        this.externalId.set(p.externalId || null)
        this.form = {
          name: p.name || '',
          acronym: p.acronym || '',
          price: p.price || 0,
          taxInside: p.taxInside ?? 19,
          taxOutside: p.taxOutside ?? 7,
          productType: p.productType || 'PRODUCT',
          status: p.status || 'ACTIVE',
          description: p.description || '',
          categoryIds: Array.isArray(p.categoryIds) ? p.categoryIds : [],
        }
      } catch {
        this.error.set('Produkt nicht gefunden')
      }
    }
  }

  toggleCategory(id: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked
    if (checked) {
      this.form.categoryIds = [...this.form.categoryIds, id]
    } else {
      this.form.categoryIds = this.form.categoryIds.filter(cid => cid !== id)
    }
  }

  async onSave() {
    if (!this.form.name || !this.form.acronym) {
      this.error.set('Name und Kürzel sind erforderlich')
      return
    }
    this.saving.set(true)
    this.error.set(null)
    try {
      const data: any = { ...this.form }
      if (!data.description) delete data.description
      if (this.isNew()) {
        await this.api.create('products', data)
      } else {
        await this.api.patch('products', this.id()!, data)
      }
      this.router.navigate(['/products'])
    } catch (e: any) {
      this.error.set(formatApiError(e))
    }
    this.saving.set(false)
  }
}
