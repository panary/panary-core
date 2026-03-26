import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, signal, OnInit, input, output, effect, viewChild } from '@angular/core'
import { FormsModule, NgForm } from '@angular/forms'
import { Router } from '@angular/router'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'
import { objectHash } from '../../core/dirty-check'

interface ProductGroup {
  _id: string
  name: string
  color: string
}

interface OptionGroupOption {
  productId: string
  priceAdjustment: number
  isDefault: boolean
}

interface OptionGroup {
  id: string
  name: string
  minSelections: number
  maxSelections: number
  freeQuantity: number
  options: OptionGroupOption[]
}

interface MinimalProduct {
  _id: string
  name: string
  acronym: string
  productType: string
}

const INPUT = `w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
               focus:border-white focus:ring-1 focus:ring-white outline-none`
const INPUT_SM = `w-full bg-gray-900 border border-gray-800 rounded-lg p-2.5 text-white text-sm
                  focus:border-white focus:ring-1 focus:ring-white outline-none`
const LABEL = 'text-xs font-medium text-gray-400 uppercase tracking-wider'
const LABEL_SM = 'text-xs text-gray-500 uppercase tracking-wider'

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="panelMode() ? 'p-5 space-y-5' : 'p-8 max-w-4xl space-y-6'">
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

      <form #f="ngForm" (ngSubmit)="onSave()" class="space-y-5">
        <!-- Typ-Pille (gleitend) -->
        <div class="relative flex bg-gray-950 rounded-2xl p-1.5 border border-gray-800">
          <!-- Gleitende Pille -->
          <div class="absolute top-1.5 bottom-1.5 rounded-xl bg-gray-800 shadow-lg transition-all duration-300 ease-out"
               [style.left]="'calc(' + typeIndex * (100 / 3) + '% + 6px)'"
               [style.width]="'calc(' + 100 / 3 + '% - 4px)'">
          </div>
          @for (t of productTypes; track t.value) {
            <button type="button" (click)="form.productType = t.value"
              [class]="form.productType === t.value ? 'text-white font-semibold' : 'text-gray-500 hover:text-gray-300'"
              class="relative z-10 flex-1 py-2.5 text-center text-sm rounded-xl transition-colors duration-200">
              {{ t.label }}
            </button>
          }
          <input type="hidden" [(ngModel)]="form.productType" name="productType" />
        </div>

        <!-- Status-Pille -->
        <div class="relative flex bg-gray-950 rounded-2xl p-1.5 border border-gray-800">
          <div class="absolute top-1.5 bottom-1.5 rounded-xl shadow-lg transition-all duration-300 ease-out"
               [class]="statusPillBg()"
               [style.left]="'calc(' + statusIndex * (100 / 3) + '% + 6px)'"
               [style.width]="'calc(' + 100 / 3 + '% - 4px)'">
          </div>
          @for (s of statuses; track s.value) {
            <button type="button" (click)="form.status = s.value"
              [class]="form.status === s.value ? 'text-white font-semibold' : 'text-gray-500 hover:text-gray-300'"
              class="relative z-10 flex-1 py-2 text-center text-sm rounded-xl transition-colors duration-200">
              {{ s.label }}
            </button>
          }
          <input type="hidden" [(ngModel)]="form.status" name="status" />
        </div>

        <!-- Name + Kürzel -->
        <div class="grid grid-cols-3 gap-4">
          <div class="col-span-2 space-y-1">
            <label class="${LABEL}">Name *</label>
            <input [(ngModel)]="form.name" name="name" type="text" required class="${INPUT}" />
          </div>
          <div class="space-y-1">
            <label class="${LABEL}">Kürzel *</label>
            <input [(ngModel)]="form.acronym" name="acronym" type="text" required maxlength="10"
              class="${INPUT} font-mono" />
          </div>
        </div>

        <!-- Preis + Steuern -->
        <div class="grid grid-cols-3 gap-4">
          <div class="space-y-1">
            <label class="${LABEL}">Preis (&euro;) *</label>
            <input [(ngModel)]="form.price" name="price" type="number" step="0.01" min="0"
              class="${INPUT} font-mono" />
          </div>
          <div class="space-y-1">
            <label class="${LABEL}">MwSt. Inhaus (%)</label>
            <input [(ngModel)]="form.taxInside" name="taxInside" type="number" step="0.1"
              class="${INPUT} font-mono" />
          </div>
          <div class="space-y-1">
            <label class="${LABEL}">MwSt. Außer Haus (%)</label>
            <input [(ngModel)]="form.taxOutside" name="taxOutside" type="number" step="0.1"
              class="${INPUT} font-mono" />
          </div>
        </div>

        <!-- Bundle-Preisgestaltung (nur bei BUNDLE) -->
        @if (form.productType === 'BUNDLE') {
          <div class="space-y-1">
            <label class="${LABEL}">Bundle-Preisgestaltung</label>
            <select [(ngModel)]="form.bundlePricingMode" name="bundlePricingMode" class="${INPUT}">
              <option value="ROLLUP">Rollup (Summe der Einzelpreise)</option>
              <option value="FIXED_PROPORTIONAL">Fixer Preis (proportional aufgeteilt)</option>
            </select>
          </div>
        }

        <!-- Produktgruppen -->
        @if (productGroups().length > 0) {
          <div class="space-y-2">
            <label class="${LABEL}">Produktgruppen</label>
            <div class="bg-gray-900/50 border border-gray-800 rounded-lg p-4 grid grid-cols-2 gap-2">
              @for (group of productGroups(); track group._id) {
                <label class="flex items-center gap-2 cursor-pointer hover:text-white transition text-gray-300 text-sm">
                  <input type="checkbox" [value]="group._id" [checked]="form.categoryIds.includes(group._id)"
                    (change)="toggleCategory(group._id, $event)" class="w-4 h-4 accent-white" />
                  <span class="inline-block w-3 h-3 rounded-full shrink-0 border border-gray-700"
                        [style.background-color]="group.color"></span>
                  {{ group.name }}
                </label>
              }
            </div>
          </div>
        }

        <!-- OptionGroups Editor -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="${LABEL}">Optionsgruppen ({{ optionGroups().length }})</label>
            <button type="button" (click)="addGroup()"
              class="text-xs text-gray-400 hover:text-white border border-gray-800 hover:border-gray-600
                     px-3 py-1.5 rounded-lg transition">
              + Gruppe
            </button>
          </div>

          @for (group of optionGroups(); track group.id; let gi = $index) {
            <div class="border border-gray-800 rounded-xl overflow-hidden">
              <!-- Group Header -->
              <div class="flex items-center gap-3 px-4 py-3 bg-gray-900/60 cursor-pointer"
                   (click)="toggleCollapse(group.id)">
                <span class="text-gray-500 text-xs w-4">{{ isCollapsed(group.id) ? '▶' : '▼' }}</span>
                <span class="flex-1 text-sm font-medium text-white truncate">
                  {{ group.name || 'Unbenannte Gruppe' }}
                </span>
                <span class="text-xs text-gray-600">{{ group.options.length }} Option(en)</span>
                <button type="button" (click)="removeGroup(group.id); $event.stopPropagation()"
                  class="text-gray-600 hover:text-red-400 text-xs px-2 transition">&#x2715;</button>
              </div>

              @if (!isCollapsed(group.id)) {
                <div class="p-4 space-y-4 bg-gray-900/20">
                  <!-- Gruppenname -->
                  <div class="space-y-1">
                    <label class="${LABEL_SM}">Gruppenname *</label>
                    <input [(ngModel)]="group.name" [name]="'og_' + gi + '_name'" type="text"
                      required placeholder="z.B. Saucen & Dips" class="${INPUT_SM}" />
                  </div>

                  <!-- Min / Max / Gratis -->
                  <div class="grid grid-cols-3 gap-3">
                    <div class="space-y-1">
                      <label class="${LABEL_SM}">Min. Auswahl</label>
                      <input [(ngModel)]="group.minSelections" [name]="'og_' + gi + '_min'"
                        type="number" min="0" class="${INPUT_SM} font-mono" />
                    </div>
                    <div class="space-y-1">
                      <label class="${LABEL_SM}">Max. Auswahl</label>
                      <input [(ngModel)]="group.maxSelections" [name]="'og_' + gi + '_max'"
                        type="number" min="1" class="${INPUT_SM} font-mono" />
                    </div>
                    <div class="space-y-1">
                      <label class="${LABEL_SM}">Gratis-Anzahl</label>
                      <input [(ngModel)]="group.freeQuantity" [name]="'og_' + gi + '_free'"
                        type="number" min="0" class="${INPUT_SM} font-mono" />
                    </div>
                  </div>

                  <!-- Optionen -->
                  <div class="space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="${LABEL_SM}">Optionen</span>
                      <button type="button" (click)="addOption(group)"
                        class="text-xs text-gray-500 hover:text-white transition px-2 py-1
                               border border-gray-800 hover:border-gray-600 rounded-lg">
                        + Option
                      </button>
                    </div>

                    @if (group.options.length === 0) {
                      <p class="text-gray-700 text-xs text-center py-3">Keine Optionen — klicke "+ Option"</p>
                    }

                    @for (opt of group.options; track $index; let oi = $index) {
                      <div class="flex items-center gap-2 bg-gray-900/50 border border-gray-800 rounded-lg p-2">
                        <!-- Produkt auswählen -->
                        <select [(ngModel)]="opt.productId" [name]="'og_' + gi + '_opt_' + oi + '_pid'"
                          class="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-2 py-1.5 text-white text-sm
                                 outline-none min-w-0">
                          <option value="">Produkt wählen...</option>
                          @for (p of allProducts(); track p._id) {
                            <option [value]="p._id">{{ p.name }} ({{ p.acronym }})</option>
                          }
                        </select>
                        <!-- Preisaufschlag -->
                        <div class="flex items-center gap-1 shrink-0">
                          <span class="text-gray-600 text-xs">+&euro;</span>
                          <input [(ngModel)]="opt.priceAdjustment" [name]="'og_' + gi + '_opt_' + oi + '_adj'"
                            type="number" step="0.01" placeholder="0.00"
                            class="w-20 bg-gray-900 border border-gray-800 rounded-lg px-2 py-1.5 text-white text-sm
                                   outline-none font-mono" />
                        </div>
                        <!-- Standard -->
                        <label class="flex items-center gap-1 text-xs text-gray-500 shrink-0 cursor-pointer">
                          <input [(ngModel)]="opt.isDefault" [name]="'og_' + gi + '_opt_' + oi + '_def'"
                            type="checkbox" class="w-3 h-3 accent-white" />
                          Std.
                        </label>
                        <!-- Entfernen -->
                        <button type="button" (click)="removeOption(group, oi)"
                          class="text-gray-600 hover:text-red-400 text-xs shrink-0 transition px-1">&#x2715;</button>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- Fehler -->
        @if (error()) {
          <p class="text-red-400 text-sm">{{ error() }}</p>
        }

        <!-- Aktionen -->
        <div class="flex gap-3 pt-4">
          <button type="submit" [disabled]="saving() || savedSuccess()"
            [class]="'save-btn ' + (savedSuccess() ? 'save-btn--success' : saving() ? 'save-btn--saving' : 'save-btn--default')"
            [class.opacity-50]="!form.name && !saving() && !savedSuccess()"
            [class.cursor-not-allowed]="!form.name">
            <span class="save-btn__content">
              @if (savedSuccess()) {
                <svg class="save-checkmark" viewBox="0 0 24 24">
                  <path d="M4 12l6 6L20 6" />
                </svg>
                Gespeichert
              } @else if (saving()) {
                <span class="save-spinner"></span>
              } @else {
                Speichern
              }
            </span>
          </button>
          <button type="button" (click)="panelMode() ? closed.emit() : router.navigate(['/products'])"
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
  private cdr = inject(ChangeDetectorRef)

  id = input<string>()
  panelMode = input(false)
  saved = output<void>()
  closed = output<void>()

  isNew = signal(true)
  saving = signal(false)
  savedSuccess = signal(false)
  error = signal<string | null>(null)
  productGroups = signal<ProductGroup[]>([])
  entityId = signal<string>('')
  externalId = signal<string | null>(null)

  // OptionGroups + Produktkatalog
  optionGroups = signal<OptionGroup[]>([])
  allProducts = signal<MinimalProduct[]>([])
  collapsedGroups = signal<Set<string>>(new Set())

  productTypes = [
    { value: 'PRODUCT', label: 'Produkt' },
    { value: 'MODIFIER', label: 'Modifier' },
    { value: 'BUNDLE', label: 'Menü' },
  ]

  get typeIndex(): number {
    return this.productTypes.findIndex(t => t.value === this.form.productType)
  }

  statuses = [
    { value: 'DRAFT', label: 'Entwurf' },
    { value: 'ACTIVE', label: 'Aktiv' },
    { value: 'ARCHIVED', label: 'Archiviert' },
  ]

  get statusIndex(): number {
    return this.statuses.findIndex(s => s.value === this.form.status)
  }

  statusPillBg(): string {
    switch (this.form.status) {
      case 'ACTIVE': return 'bg-green-800/60'
      case 'DRAFT': return 'bg-yellow-800/40'
      case 'ARCHIVED': return 'bg-gray-800'
      default: return 'bg-gray-800'
    }
  }
  private formRef = viewChild<NgForm>('f')
  private originalHash = ''

  /** Ob das Formular ungespeicherte Änderungen hat */
  isDirty(): boolean {
    if (this.isNew()) return !!this.form.name
    return objectHash({ ...this.form, og: this.optionGroups() }) !== this.originalHash
  }

  form = {
    name: '',
    acronym: '',
    price: 0,
    taxInside: 19,
    taxOutside: 7,
    productType: 'PRODUCT',
    status: 'DRAFT',
    bundlePricingMode: 'ROLLUP' as 'ROLLUP' | 'FIXED_PROPORTIONAL',
    categoryIds: [] as string[],
  }

  constructor() {
    // Reagiert auf ID-Änderungen (Prev/Next im Panel)
    effect(() => {
      const prodId = this.id()
      this.loadProduct(prodId)
    })
  }

  async ngOnInit() {
    // Stammdaten einmalig laden
    try {
      const [groupResult, productResult] = await Promise.all([
        this.api.find<ProductGroup>('product-groups', { $limit: 100 }),
        this.api.find<MinimalProduct>('products', { $limit: 200 }),
      ])
      this.productGroups.set(groupResult.data)
      this.allProducts.set(productResult.data)
    } catch (e) {
      console.error('Fehler beim Laden der Stammdaten:', e)
    }
  }

  private async loadProduct(prodId: string | undefined) {
    // Form-Controls zurücksetzen (verhindert kurzes Aufblitzen von Validierungsfehlern)
    this.formRef()?.resetForm()
    this.error.set(null)
    this.form = {
      name: '', acronym: '', price: 0, taxInside: 19, taxOutside: 7,
      productType: 'PRODUCT', status: 'DRAFT', bundlePricingMode: 'ROLLUP',
      categoryIds: [],
    }
    this.optionGroups.set([])
    this.entityId.set('')
    this.externalId.set(null)
    this.collapsedGroups.set(new Set())

    if (!prodId || prodId === 'new') {
      this.isNew.set(true)
      return
    }

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
        bundlePricingMode: p.bundlePricingMode || 'ROLLUP',
        categoryIds: Array.isArray(p.categoryIds) ? p.categoryIds : [],
      }
      if (Array.isArray(p.optionGroups)) {
        this.optionGroups.set(
          p.optionGroups.map((g: any) => ({
            id: g.id || crypto.randomUUID(),
            name: g.name || '',
            minSelections: g.minSelections ?? 0,
            maxSelections: g.maxSelections ?? 1,
            freeQuantity: g.freeQuantity ?? 0,
            options: Array.isArray(g.options)
              ? g.options.map((o: any) => ({
                  productId: o.productId || '',
                  priceAdjustment: o.priceAdjustment ?? 0,
                  isDefault: o.isDefault ?? false,
                }))
              : [],
          })),
        )
      }
      this.originalHash = objectHash({ ...this.form, og: this.optionGroups() })
    } catch {
      this.error.set('Produkt nicht gefunden')
    }
    this.cdr.markForCheck()
  }

  // --- Kategorien ---

  toggleCategory(id: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked
    if (checked) {
      this.form.categoryIds = [...this.form.categoryIds, id]
    } else {
      this.form.categoryIds = this.form.categoryIds.filter(cid => cid !== id)
    }
  }

  // --- OptionGroup Mutationen ---

  addGroup() {
    this.optionGroups.update(gs => [
      ...gs,
      {
        id: crypto.randomUUID(),
        name: '',
        minSelections: 0,
        maxSelections: 1,
        freeQuantity: 0,
        options: [],
      },
    ])
  }

  removeGroup(groupId: string) {
    this.optionGroups.update(gs => gs.filter(g => g.id !== groupId))
  }

  addOption(group: OptionGroup) {
    group.options = [...group.options, { productId: '', priceAdjustment: 0, isDefault: false }]
    this.optionGroups.update(gs => [...gs])
  }

  removeOption(group: OptionGroup, index: number) {
    group.options = group.options.filter((_, i) => i !== index)
    this.optionGroups.update(gs => [...gs])
  }

  toggleCollapse(groupId: string) {
    this.collapsedGroups.update(s => {
      const next = new Set(s)
      next.has(groupId) ? next.delete(groupId) : next.add(groupId)
      return next
    })
  }

  isCollapsed(groupId: string): boolean {
    return this.collapsedGroups().has(groupId)
  }

  /** Speichern und danach eine Callback-Aktion ausführen (für dirty-check Dialog) */
  async saveAndContinue(): Promise<boolean> {
    await this.onSave()
    return !this.error()
  }

  /** Änderungen verwerfen (Hash zurücksetzen) */
  discardChanges(): void {
    this.originalHash = objectHash({ ...this.form, og: this.optionGroups() })
  }

  // --- Speichern ---

  async onSave() {
    if (!this.form.name || !this.form.acronym) {
      this.error.set('Name und Kürzel sind erforderlich')
      return
    }
    this.saving.set(true)
    this.error.set(null)

    try {
      const data: any = { ...this.form }

      // bundlePricingMode nur bei BUNDLE senden
      if (data.productType !== 'BUNDLE') delete data.bundlePricingMode

      // OptionGroups serialisieren
      const groups = this.optionGroups()
      data.optionGroups = groups.map(g => ({
        id: g.id,
        name: g.name,
        minSelections: Number(g.minSelections) || 0,
        maxSelections: Number(g.maxSelections) || 1,
        freeQuantity: Number(g.freeQuantity) || 0,
        options: g.options
          .filter(o => o.productId)
          .map(o => ({
            productId: o.productId,
            ...(Number(o.priceAdjustment) ? { priceAdjustment: Number(o.priceAdjustment) } : {}),
            ...(o.isDefault ? { isDefault: true } : {}),
          })),
      }))

      // Leere Gruppen ohne Namen entfernen
      data.optionGroups = data.optionGroups.filter((g: any) => g.name)

      if (this.isNew()) {
        await this.api.create('products', data)
      } else {
        await this.api.patch('products', this.id()!, data)
      }
      this.originalHash = objectHash({ ...this.form, og: this.optionGroups() })
      this.savedSuccess.set(true)
      this.cdr.markForCheck()
      if (this.panelMode()) this.saved.emit()
      setTimeout(() => {
        this.savedSuccess.set(false)
        this.cdr.markForCheck()
        if (!this.panelMode()) this.router.navigate(['/products'])
      }, 2000)
    } catch (e: any) {
      this.error.set(formatApiError(e))
    }
    this.saving.set(false)
  }
}
