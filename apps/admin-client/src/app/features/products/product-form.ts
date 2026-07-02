import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, signal, OnInit, input, output, effect, viewChild } from '@angular/core'
import { FormsModule, NgForm } from '@angular/forms'
import { Router } from '@angular/router'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'
import { objectHash } from '../../core/dirty-check'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'
import { SearchableSelectComponent } from '../../shared/searchable-select'
import { uuidv7 } from 'uuidv7'

interface ProductGroup {
  _id: string
  externalId?: string | null
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
  categoryIds: string[]
}

const INPUT = `w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
               text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
               focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none`
const INPUT_SM = `w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-2.5
                  text-slate-900 dark:text-white text-sm focus:border-slate-900 dark:focus:border-white
                  focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none`
const LABEL = 'text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider'
const LABEL_SM = 'text-xs text-slate-400 dark:text-gray-500 uppercase tracking-wider'

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [FormsModule, ConfirmDialogComponent, TranslateModule, SearchableSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="panelMode() ? 'p-5 space-y-5' : 'p-8 max-w-4xl space-y-6'">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold tracking-tight">{{ (isNew() ? 'PRODUCTS.NEW_PRODUCT' : 'PRODUCTS.EDIT_PRODUCT') | translate }}</h1>
        @if (!isNew()) {
          <button type="button" (click)="showDeleteConfirm.set(true)"
            class="text-slate-400 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition p-2
                   rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        }
      </div>

      @if (showDeleteConfirm()) {
        <app-confirm-dialog
          [title]="'PRODUCTS.DELETE_PRODUCT' | translate"
          [message]="'PRODUCTS.DELETE_CONFIRM' | translate"
          [confirmLabel]="'COMMON.DELETE' | translate"
          [dismissLabel]="'COMMON.CANCEL' | translate"
          (confirmed)="onDelete()"
          (dismissed)="showDeleteConfirm.set(false)"
          (cancelled)="showDeleteConfirm.set(false)">
        </app-confirm-dialog>
      }

      <form #f="ngForm" (ngSubmit)="onSave()" class="space-y-5">
        <!-- Status-Pille -->
        <div class="relative flex bg-slate-100 dark:bg-gray-950 rounded-2xl p-1.5 border border-slate-200 dark:border-gray-800">
          <div class="absolute top-1.5 bottom-1.5 rounded-xl shadow-lg transition-all duration-300 ease-out"
               [class]="statusPillBg()"
               [style.left]="'calc(' + statusIndex * (100 / 3) + '% + 6px)'"
               [style.width]="'calc(' + 100 / 3 + '% - 4px)'">
          </div>
          @for (s of statuses; track s.value) {
            <button type="button" (click)="form.status = s.value"
              [class]="form.status === s.value
                ? 'text-slate-900 dark:text-white font-semibold'
                : 'text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300'"
              class="relative z-10 flex-1 py-2 text-center text-sm rounded-xl transition-colors duration-200">
              {{ s.label | translate }}
            </button>
          }
          <input type="hidden" [(ngModel)]="form.status" name="status" />
        </div>

        @if (!isNew()) {
          <div class="bg-slate-50 dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-lg p-4
                      grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div>
              <span class="text-slate-400 dark:text-gray-500">ID</span>
              <p class="text-slate-600 dark:text-gray-300 font-mono mt-0.5 select-all">{{ entityId() }}</p>
            </div>
            <div>
              <span class="text-slate-400 dark:text-gray-500">External ID</span>
              <p class="text-slate-600 dark:text-gray-300 font-mono mt-0.5 select-all">{{ externalId() || '—' }}</p>
            </div>
          </div>
        }

        <!-- Name + Kürzel -->
        <div class="grid grid-cols-3 gap-4">
          <div class="col-span-2 space-y-1">
            <label for="productName" class="${LABEL}">
              <!-- Emoji-Hinweis -->
              <span class="relative inline-block mr-1 group">
                <svg class="w-3.5 h-3.5 inline-block text-slate-300 dark:text-gray-600 cursor-help
                            hover:text-slate-500 dark:hover:text-gray-400 transition -mt-0.5"
                     viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 16v-4"></path>
                  <path d="M12 8h.01"></path>
                </svg>
                <span class="absolute top-1/2 left-full -translate-y-1/2 ml-2 px-3 py-2 rounded-lg
                             bg-slate-900 dark:bg-white text-white dark:text-black text-[10px] leading-relaxed
                             whitespace-nowrap opacity-0 pointer-events-none
                             group-hover:opacity-100 transition-opacity shadow-lg z-30">
                  Emoji links eingeben:<br/>
                  <strong>Mac:</strong> Ctrl + Cmd + Leertaste<br/>
                  <strong>Win:</strong> Win + . (Punkt)<br/>
                  Oder: Emoji kopieren &amp; einfügen
                  <span class="absolute top-1/2 right-full -translate-y-1/2 -mr-px
                               border-4 border-transparent border-r-slate-900 dark:border-r-white"></span>
                </span>
              </span>
              {{ 'COMMON.NAME' | translate }} *
            </label>
            <div class="flex items-center ${INPUT} !p-0 overflow-hidden">
              <input id="productIcon" [(ngModel)]="form.icon" name="icon" type="text" maxlength="4"
                placeholder="🍽"
                class="w-11 h-full shrink-0 text-center text-lg bg-transparent outline-none border-r
                       border-slate-200 dark:border-gray-800 p-3" />
              <input id="productName" [(ngModel)]="form.name" name="name" type="text" required
                class="flex-1 bg-transparent outline-none p-3" />
            </div>
          </div>
          <div class="space-y-1">
            <label for="productAcronym" class="${LABEL}">{{ 'PRODUCTS.ACRONYM' | translate }} *</label>
            <input id="productAcronym" [(ngModel)]="form.acronym" name="acronym" type="text" required maxlength="10"
              class="${INPUT} font-mono" />
          </div>
        </div>

        <!-- Typ-Pille (gleitend) -->
        <div class="relative flex bg-slate-100 dark:bg-gray-950 rounded-2xl p-1.5 border border-slate-200 dark:border-gray-800">
          <!-- Gleitende Pille -->
          <div class="absolute top-1.5 bottom-1.5 rounded-xl bg-white dark:bg-gray-800 shadow-lg transition-all duration-300 ease-out"
               [style.left]="'calc(' + typeIndex * (100 / 3) + '% + 6px)'"
               [style.width]="'calc(' + 100 / 3 + '% - 4px)'">
          </div>
          @for (t of productTypes; track t.value) {
            <button type="button" (click)="form.productType = t.value"
              [class]="form.productType === t.value
                ? 'text-slate-900 dark:text-white font-semibold'
                : 'text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300'"
              class="relative z-10 flex-1 py-2.5 text-center text-sm rounded-xl transition-colors duration-200">
              {{ t.label | translate }}
            </button>
          }
          <input type="hidden" [(ngModel)]="form.productType" name="productType" />
        </div>

        <!-- Preis + Steuern -->
        <div class="grid grid-cols-3 gap-4">
          <div class="space-y-1">
            <label for="productPrice" class="${LABEL}">{{ 'PRODUCTS.PRICE' | translate }} (&euro;) *</label>
            <input id="productPrice" [(ngModel)]="form.price" name="price" type="number" step="0.01" min="0"
              class="${INPUT} font-mono" />
          </div>
          <div class="space-y-1">
            <label for="productTaxInside" class="${LABEL}">{{ 'PRODUCTS.TAX_INSIDE' | translate }}</label>
            <input id="productTaxInside" [(ngModel)]="form.taxInside" name="taxInside" type="number" step="0.1"
              class="${INPUT} font-mono" />
          </div>
          <div class="space-y-1">
            <label for="productTaxOutside" class="${LABEL}">{{ 'PRODUCTS.TAX_OUTSIDE' | translate }}</label>
            <input id="productTaxOutside" [(ngModel)]="form.taxOutside" name="taxOutside" type="number" step="0.1"
              class="${INPUT} font-mono" />
          </div>
        </div>

        <!-- Bundle-Preisgestaltung (nur bei BUNDLE) -->
        @if (form.productType === 'BUNDLE') {
          <div class="space-y-1">
            <label for="productBundlePricingMode" class="${LABEL}">{{ 'PRODUCTS.BUNDLE_PRICING' | translate }}</label>
            <select id="productBundlePricingMode" [(ngModel)]="form.bundlePricingMode" name="bundlePricingMode" class="${INPUT}">
              <option value="ROLLUP">{{ 'PRODUCTS.BUNDLE_ROLLUP' | translate }}</option>
              <option value="FIXED_PROPORTIONAL">{{ 'PRODUCTS.BUNDLE_FIXED' | translate }}</option>
            </select>
          </div>
        }

        <!-- Produktgruppen -->
        @if (productGroups().length > 0) {
          <div class="space-y-2">
            <span class="${LABEL}">{{ 'PRODUCT_GROUPS.TITLE' | translate }}</span>
            <div class="bg-slate-50 dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-lg p-4
                        grid grid-cols-2 gap-2">
              @for (group of productGroups(); track group._id) {
                <label class="flex items-center gap-2 cursor-pointer hover:text-slate-900 dark:hover:text-white
                              transition text-slate-600 dark:text-gray-300 text-sm">
                  <input type="checkbox" [value]="group.externalId ?? group._id" [checked]="isGroupSelected(group)"
                    (change)="toggleCategory(group, $event)"
                    class="w-4 h-4 accent-slate-900 dark:accent-white" />
                  <span class="inline-block w-3 h-3 rounded-full shrink-0 border border-slate-300 dark:border-gray-700"
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
            <span class="${LABEL}">{{ 'PRODUCTS.OPTION_GROUPS' | translate }} ({{ optionGroups().length }})</span>
            <div class="flex items-center gap-1">
              <button type="button" (click)="showCopyFromPicker.set(true)"
                class="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white
                       border border-slate-200 dark:border-gray-800 hover:border-slate-400 dark:hover:border-gray-600
                       px-3 py-1.5 rounded-lg transition">
                Von Produkt übernehmen
              </button>
              <button type="button" (click)="addGroup()"
                class="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white
                       border border-slate-200 dark:border-gray-800 hover:border-slate-400 dark:hover:border-gray-600
                       px-3 py-1.5 rounded-lg transition">
                + {{ 'PRODUCTS.GROUP' | translate }}
              </button>
            </div>
          </div>

          @for (group of optionGroups(); track group.id; let gi = $index) {
            <div class="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <!-- Group Header -->
              <div class="flex items-center gap-3 px-4 py-3 bg-slate-200/70 dark:bg-gray-800/80 cursor-pointer"
                   role="button" tabindex="0"
                   (click)="toggleCollapse(group.id)" (keydown.enter)="toggleCollapse(group.id)">
                <span class="text-slate-400 dark:text-gray-500 text-xs w-4">{{ isCollapsed(group.id) ? '▶' : '▼' }}</span>
                <span class="flex-1 text-sm font-medium text-slate-900 dark:text-white truncate">
                  {{ group.name || ('PRODUCTS.UNNAMED_GROUP' | translate) }}
                </span>
                <span class="text-xs text-slate-400 dark:text-gray-600">{{ group.options.length }} Option(en)</span>
                <button type="button" (click)="removeGroup(group.id); $event.stopPropagation()"
                  class="text-slate-400 dark:text-gray-600 hover:text-red-400 text-xs px-2 transition">&#x2715;</button>
              </div>

              @if (!isCollapsed(group.id)) {
                <div class="p-4 space-y-4 bg-slate-50 dark:bg-gray-900/20">
                  <!-- Gruppenname -->
                  <div class="space-y-1">
                    <label [attr.for]="'optGroupName-' + gi" class="${LABEL_SM}">{{ 'PRODUCTS.GROUP_NAME' | translate }} *</label>
                    <input [id]="'optGroupName-' + gi" [(ngModel)]="group.name" [name]="'og_' + gi + '_name'" type="text"
                      required placeholder="z.B. Saucen & Dips" class="${INPUT_SM}" />
                  </div>

                  <!-- Min / Max / Gratis -->
                  <div class="grid grid-cols-3 gap-3">
                    <div class="space-y-1">
                      <label [attr.for]="'optGroupMin-' + gi" class="${LABEL_SM}">{{ 'PRODUCTS.MIN_SELECTION' | translate }}</label>
                      <input [id]="'optGroupMin-' + gi" [(ngModel)]="group.minSelections" [name]="'og_' + gi + '_min'"
                        type="number" min="0" class="${INPUT_SM} font-mono" />
                    </div>
                    <div class="space-y-1">
                      <label [attr.for]="'optGroupMax-' + gi" class="${LABEL_SM}">{{ 'PRODUCTS.MAX_SELECTION' | translate }}</label>
                      <input [id]="'optGroupMax-' + gi" [(ngModel)]="group.maxSelections" [name]="'og_' + gi + '_max'"
                        type="number" min="1" class="${INPUT_SM} font-mono" />
                    </div>
                    <div class="space-y-1">
                      <label [attr.for]="'optGroupFree-' + gi" class="${LABEL_SM}">{{ 'PRODUCTS.FREE_QUANTITY' | translate }}</label>
                      <input [id]="'optGroupFree-' + gi" [(ngModel)]="group.freeQuantity" [name]="'og_' + gi + '_free'"
                        type="number" min="0" class="${INPUT_SM} font-mono" />
                    </div>
                  </div>

                  <!-- Optionen -->
                  <div class="space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="${LABEL_SM}">{{ 'PRODUCTS.OPTIONS' | translate }}</span>
                      <div class="flex items-center gap-1">
                        <!-- Gruppe hinzufügen -->
                        <button type="button" (click)="openCategoryPicker($event, group.id)"
                          class="text-xs text-slate-400 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white
                                 transition px-2 py-1 border border-slate-200 dark:border-gray-800
                                 hover:border-slate-400 dark:hover:border-gray-600 rounded-lg">
                          + Gruppe
                        </button>
                        <!-- Alle löschen -->
                        @if (group.options.length > 0) {
                          <button type="button" (click)="clearOptions(group)"
                            class="text-xs text-red-400/70 hover:text-red-500
                                   transition px-2 py-1 border border-slate-200 dark:border-gray-800
                                   hover:border-red-300 dark:hover:border-red-800 rounded-lg">
                            Alle löschen
                          </button>
                        }
                        <!-- + Option -->
                        <button type="button" (click)="addOption(group)"
                          class="text-xs text-slate-400 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white
                                 transition px-2 py-1 border border-slate-200 dark:border-gray-800
                                 hover:border-slate-400 dark:hover:border-gray-600 rounded-lg">
                          + Option
                        </button>
                      </div>
                    </div>

                    @if (group.options.length === 0) {
                      <p class="text-slate-300 dark:text-gray-700 text-xs text-center py-3">
                        {{ 'PRODUCTS.NO_OPTIONS' | translate }}
                      </p>
                    }

                    @for (opt of group.options; track $index; let oi = $index) {
                      <div class="flex items-center gap-2 bg-white dark:bg-gray-900/50 border border-slate-200
                                  dark:border-gray-800 rounded-lg p-2">
                        <!-- Produkt auswählen -->
                        <app-searchable-select class="flex-1 min-w-0"
                          [items]="productSelectItems()"
                          [(value)]="opt.productId"
                          placeholder="Produkt suchen..." />
                        <!-- Preisaufschlag -->
                        <div class="flex items-center gap-1 shrink-0">
                          <span class="text-slate-400 dark:text-gray-600 text-xs">+&euro;</span>
                          <input [(ngModel)]="opt.priceAdjustment" [name]="'og_' + gi + '_opt_' + oi + '_adj'"
                            type="number" step="0.01" placeholder="0.00"
                            class="w-20 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800
                                   rounded-lg px-2 py-1.5 text-slate-900 dark:text-white text-sm outline-none font-mono" />
                        </div>
                        <!-- Standard -->
                        <label class="flex items-center gap-1 text-xs text-slate-400 dark:text-gray-500 shrink-0 cursor-pointer">
                          <input [(ngModel)]="opt.isDefault" [name]="'og_' + gi + '_opt_' + oi + '_def'"
                            type="checkbox" class="w-3 h-3 accent-slate-900 dark:accent-white" />
                          Std.
                        </label>
                        <!-- Entfernen -->
                        <button type="button" (click)="removeOption(group, oi)"
                          class="text-slate-400 dark:text-gray-600 hover:text-red-400 text-xs shrink-0 transition px-1">
                          &#x2715;
                        </button>
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
          <p class="text-red-500 dark:text-red-400 text-sm">{{ error() }}</p>
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
                {{ 'COMMON.SAVED' | translate }}
              } @else if (saving()) {
                <span class="save-spinner"></span>
              } @else {
                {{ 'COMMON.SAVE' | translate }}
              }
            </span>
          </button>
          <button type="button" (click)="panelMode() ? closed.emit() : router.navigate(['/products'])"
            class="bg-slate-100 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-slate-600
                   dark:text-gray-300 px-6 py-3 rounded-xl text-sm hover:bg-slate-200 dark:hover:bg-gray-800 transition">
            {{ 'COMMON.CANCEL' | translate }}
          </button>
        </div>
      </form>
    </div>

    <!-- Kategorie-Picker (fixed, überlagert alles) -->
    @if (activeCategoryPicker()) {
      <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
      <div class="fixed inset-0 z-50" (click)="activeCategoryPicker.set(null)">
        <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
        <div class="fixed min-w-48 max-h-64 overflow-y-auto bg-white dark:bg-gray-950
                    border border-slate-200 dark:border-gray-800 rounded-lg shadow-2xl py-1"
             [style.top.px]="pickerPos().top" [style.left.px]="pickerPos().left"
             (click)="$event.stopPropagation()">
          @for (pg of productGroups(); track pg._id) {
            <button type="button" (click)="addProductsByCategory(pickerGroup()!, pg)"
              class="w-full text-left px-3 py-1.5 text-sm text-slate-700 dark:text-gray-300
                     hover:bg-slate-50 dark:hover:bg-gray-800 transition flex items-center gap-2">
              <span class="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    [style.background-color]="pg.color"></span>
              {{ pg.name }}
            </button>
          } @empty {
            <p class="px-3 py-2 text-xs text-slate-300 dark:text-gray-600">Keine Gruppen</p>
          }
        </div>
      </div>
    }

    <!-- Produkt-Picker für Options-Gruppen-Übernahme -->
    @if (showCopyFromPicker()) {
      <app-searchable-select
        [items]="productSelectItems()"
        [(value)]="copyFromValue"
        [autoOpen]="true"
        (selected)="copyGroupsFromProduct($event)"
        (closed)="showCopyFromPicker.set(false)"
        placeholder="Quellprodukt suchen..." />
    }
  `,
})
export class ProductFormComponent implements OnInit {
  private api = inject(ApiService)
  router = inject(Router)
  private cdr = inject(ChangeDetectorRef)
  private t = inject(TranslateService)

  id = input<string>()
  panelMode = input(false)
  saved = output<void>()
  closed = output<void>()

  isNew = signal(true)
  saving = signal(false)
  savedSuccess = signal(false)
  error = signal<string | null>(null)
  showDeleteConfirm = signal(false)
  productGroups = signal<ProductGroup[]>([])
  entityId = signal<string>('')
  externalId = signal<string | null>(null)

  // OptionGroups + Produktkatalog
  optionGroups = signal<OptionGroup[]>([])
  allProducts = signal<MinimalProduct[]>([])
  productSelectItems = computed(() =>
    this.allProducts().map(p => ({ id: p._id, label: p.name, sublabel: p.acronym })),
  )
  collapsedGroups = signal<Set<string>>(new Set())
  activeCategoryPicker = signal<string | null>(null)
  pickerPos = signal<{ top: number; left: number }>({ top: 0, left: 0 })
  pickerGroup = signal<OptionGroup | null>(null)
  showCopyFromPicker = signal(false)
  copyFromValue = signal('')

  productTypes = [
    { value: 'PRODUCT', label: 'PRODUCTS.TYPE_PRODUCT' },
    { value: 'MODIFIER', label: 'PRODUCTS.TYPE_MODIFIER' },
    { value: 'BUNDLE', label: 'PRODUCTS.TYPE_BUNDLE' },
  ]

  get typeIndex(): number {
    return this.productTypes.findIndex(t => t.value === this.form.productType)
  }

  statuses = [
    { value: 'DRAFT', label: 'COMMON.STATUS_DRAFT' },
    { value: 'ACTIVE', label: 'COMMON.STATUS_ACTIVE' },
    { value: 'ARCHIVED', label: 'COMMON.STATUS_ARCHIVED' },
  ]

  get statusIndex(): number {
    return this.statuses.findIndex(s => s.value === this.form.status)
  }

  statusPillBg(): string {
    switch (this.form.status) {
      case 'ACTIVE': return 'bg-green-600/60 dark:bg-green-800/60'
      case 'DRAFT': return 'bg-yellow-500/40 dark:bg-yellow-800/40'
      case 'ARCHIVED': return 'bg-slate-300 dark:bg-gray-800'
      default: return 'bg-slate-300 dark:bg-gray-800'
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
    icon: '',
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
      const [groupResult, allProducts] = await Promise.all([
        this.api.find<ProductGroup>('product-groups', { $limit: 250 }),
        this.loadAllProducts(),
      ])
      this.productGroups.set(groupResult.data)
      this.allProducts.set(allProducts)
    } catch (e) {
      console.error('Fehler beim Laden der Stammdaten:', e)
    }
  }

  /** Lädt alle Produkte seitenweise mit $select für minimalen Payload */
  private async loadAllProducts(): Promise<MinimalProduct[]> {
    const PAGE_SIZE = 250
    const selectFields = ['_id', 'name', 'acronym', 'productType', 'categoryIds']

    // Erste Seite laden, um total zu erfahren
    const first = await this.api.find<MinimalProduct>('products', {
      $limit: PAGE_SIZE,
      $skip: 0,
      $sort: { name: 1 },
      $select: selectFields,
    })

    const all: MinimalProduct[] = [...first.data]

    // Restliche Seiten parallel laden
    if (first.total > PAGE_SIZE) {
      const pages = Math.ceil(first.total / PAGE_SIZE)
      const remaining = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          this.api.find<MinimalProduct>('products', {
            $limit: PAGE_SIZE,
            $skip: (i + 1) * PAGE_SIZE,
            $sort: { name: 1 },
            $select: selectFields,
          }),
        ),
      )
      for (const page of remaining) {
        all.push(...page.data)
      }
    }

    return all
  }

  private async loadProduct(prodId: string | undefined) {
    // Form-Controls zurücksetzen (verhindert kurzes Aufblitzen von Validierungsfehlern)
    this.formRef()?.resetForm()
    this.error.set(null)
    this.form = {
      name: '', icon: '', acronym: '', price: 0, taxInside: 19, taxOutside: 7,
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
        icon: p.icon || '',
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
            id: g.id || uuidv7(),
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
      this.error.set(this.t.instant('PRODUCTS.NOT_FOUND'))
    }
    this.cdr.markForCheck()
  }

  // --- Kategorien ---

  // categoryIds kann historisch die Gruppen-_id ODER die externalId enthalten
  // (Zielkonvention: externalId, categoryIds-Migration 2026-07) — Lesen tolerant,
  // Schreiben immer externalId-bevorzugt.
  private groupKeys(group: { _id: string; externalId?: string | null }): string[] {
    return [group.externalId, group._id].filter(Boolean) as string[]
  }

  isGroupSelected(group: { _id: string; externalId?: string | null }): boolean {
    const keys = this.groupKeys(group)
    return this.form.categoryIds.some(cid => keys.includes(cid))
  }

  toggleCategory(group: { _id: string; externalId?: string | null }, event: Event) {
    const checked = (event.target as HTMLInputElement).checked
    const keys = this.groupKeys(group)
    const rest = this.form.categoryIds.filter(cid => !keys.includes(cid))
    this.form.categoryIds = checked ? [...rest, group.externalId ?? group._id] : rest
  }

  // --- OptionGroup Mutationen ---

  addGroup() {
    this.optionGroups.update(gs => [
      ...gs,
      {
        id: uuidv7(),
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

  clearOptions(group: OptionGroup) {
    group.options = []
    this.optionGroups.update(gs => [...gs])
  }

  addProductsByCategory(group: OptionGroup, category: { _id: string; externalId?: string | null }) {
    const existing = new Set(group.options.map(o => o.productId))
    const keys = this.groupKeys(category)
    const newOptions = this.allProducts()
      .filter(p => p.categoryIds.some(cid => keys.includes(cid)) && !existing.has(p._id))
      .map(p => ({ productId: p._id, priceAdjustment: 0, isDefault: false }))
    group.options = [...group.options, ...newOptions]
    this.optionGroups.update(gs => [...gs])
    this.activeCategoryPicker.set(null)
  }

  openCategoryPicker(event: MouseEvent, groupId: string) {
    event.stopPropagation()
    const btn = event.target as HTMLElement
    const rect = btn.getBoundingClientRect()
    const dropdownH = Math.min(this.productGroups().length * 32 + 8, 264) // max-h-64 = 256 + py

    // Passt das Dropdown unter den Button? Sonst darüber anzeigen.
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow >= dropdownH ? rect.bottom + 4 : rect.top - dropdownH - 4

    // Links vom Button ausrichten, damit es nicht rechts abgeschnitten wird
    const left = Math.min(rect.left, window.innerWidth - 200)

    this.pickerPos.set({ top, left })
    this.pickerGroup.set(this.optionGroups().find(g => g.id === groupId) ?? null)
    this.activeCategoryPicker.set(groupId)
  }

  async copyGroupsFromProduct(sourceId: string) {
    try {
      const source = await this.api.get<any>('products', sourceId)
      if (!Array.isArray(source.optionGroups) || source.optionGroups.length === 0) {
        return
      }
      const copied: OptionGroup[] = source.optionGroups.map((g: any) => ({
        id: uuidv7(),
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
      }))
      this.optionGroups.update(existing => [...existing, ...copied])
    } catch (e) {
      console.error('Fehler beim Kopieren der Options-Gruppen:', e)
    }
    this.showCopyFromPicker.set(false)
    this.copyFromValue.set('')
    this.cdr.markForCheck()
  }

  toggleCollapse(groupId: string) {
    this.collapsedGroups.update(s => {
      const next = new Set(s)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
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
      this.error.set(this.t.instant('PRODUCTS.NAME_ACRONYM_REQUIRED'))
      return
    }
    this.saving.set(true)
    this.error.set(null)

    try {
      const data: any = { ...this.form }

      // Leeres Icon nicht senden
      if (!data.icon) delete data.icon

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
        const created = await this.api.create<any>('products', data)
        // Neues Produkt sofort in die lokale Liste aufnehmen (für Option-Picker)
        this.allProducts.update(list => [...list, {
          _id: created._id,
          name: created.name,
          acronym: created.acronym,
          productType: created.productType || 'PRODUCT',
          categoryIds: Array.isArray(created.categoryIds) ? created.categoryIds : [],
        }])
      } else {
        await this.api.patch('products', this.id()!, data)
        // Bestehenden Eintrag in der lokalen Liste aktualisieren
        this.allProducts.update(list =>
          list.map(p =>
            p._id === this.id()
              ? { ...p, name: this.form.name, acronym: this.form.acronym, productType: this.form.productType, categoryIds: this.form.categoryIds }
              : p,
          ),
        )
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

  async onDelete() {
    this.showDeleteConfirm.set(false)
    try {
      await this.api.remove('products', this.id()!)
      this.saved.emit()
      this.closed.emit()
      if (!this.panelMode()) this.router.navigate(['/products'])
    } catch (e: any) {
      this.error.set(formatApiError(e))
    }
  }
}
