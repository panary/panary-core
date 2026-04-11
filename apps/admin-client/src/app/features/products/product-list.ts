import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit, viewChild, ElementRef } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { ProductFormComponent } from './product-form'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'
import { ProductWizardComponent } from './product-wizard'

interface SearchFilter {
  key: string
  value: string
  label: string
}

interface SearchCommand {
  key: string
  label: string
  description: string
  values: { value: string; label: string }[]
}

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [ProductFormComponent, ConfirmDialogComponent, FormsModule, ProductWizardComponent, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full overflow-hidden">
      <!-- Linke Seite: Tabelle -->
      <div [class]="selectedId() ? 'w-72 shrink-0 border-r border-slate-200 dark:border-gray-800' : 'flex-1'"
           class="overflow-y-auto">
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between min-h-9">
            <h1 class="text-xl font-bold tracking-tight">{{ 'PRODUCTS.TITLE' | translate }}</h1>
            <div class="flex items-center gap-2">
              @if (!selectedId()) {
                <!-- Alle Buttons sichtbar wenn kein Panel -->
                <button (click)="onExport()" [disabled]="exporting()"
                  class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white text-xs
                         px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800
                         hover:bg-slate-50 dark:hover:bg-gray-800 transition">
                  {{ exporting() ? ('COMMON.EXPORTING' | translate) : ('COMMON.EXPORT' | translate) }}
                </button>
                <button (click)="fileInput()?.nativeElement?.click()" [disabled]="importing()"
                  class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white text-xs
                         px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800
                         hover:bg-slate-50 dark:hover:bg-gray-800 transition">
                  {{ importing() ? ('COMMON.IMPORTING' | translate) : ('COMMON.IMPORT' | translate) }}
                </button>
                <button (click)="showWizard.set(true)"
                  class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white text-xs
                         px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800
                         hover:bg-slate-50 dark:hover:bg-gray-800 transition flex items-center gap-1.5">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                    <path d="M2 17l10 5 10-5"></path>
                    <path d="M2 12l10 5 10-5"></path>
                  </svg>
                  {{ 'COMMON.WIZARD' | translate }}
                </button>
              } @else {
                <!-- Kebab-Menü wenn Panel geöffnet -->
                <div class="relative">
                  <button (click)="actionsMenuOpen.set(!actionsMenuOpen())"
                          class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white
                                 w-8 h-8 flex items-center justify-center rounded-lg
                                 border border-slate-200 dark:border-gray-800
                                 hover:bg-slate-50 dark:hover:bg-gray-800 transition text-base leading-none"
                          title="Weitere Aktionen">
                    ···
                  </button>
                  @if (actionsMenuOpen()) {
                    <div class="fixed inset-0 z-40" role="button" tabindex="0"
                         (click)="actionsMenuOpen.set(false)" (keydown.enter)="actionsMenuOpen.set(false)"></div>
                    <div class="absolute right-0 top-full mt-1 z-50 w-44
                                bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800
                                rounded-xl shadow-xl p-1 flex flex-col gap-0.5">
                      <button (click)="onExport(); actionsMenuOpen.set(false)" [disabled]="exporting()"
                        class="w-full text-left text-xs px-3 py-2 rounded-lg
                               text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 transition
                               disabled:opacity-50">
                        {{ exporting() ? ('COMMON.EXPORTING' | translate) : ('COMMON.EXPORT' | translate) }}
                      </button>
                      <button (click)="fileInput()?.nativeElement?.click(); actionsMenuOpen.set(false)" [disabled]="importing()"
                        class="w-full text-left text-xs px-3 py-2 rounded-lg
                               text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 transition
                               disabled:opacity-50">
                        {{ importing() ? ('COMMON.IMPORTING' | translate) : ('COMMON.IMPORT' | translate) }}
                      </button>
                      <div class="h-px bg-slate-100 dark:bg-gray-800 my-0.5"></div>
                      <button (click)="showWizard.set(true); actionsMenuOpen.set(false)"
                        class="w-full text-left text-xs px-3 py-2 rounded-lg flex items-center gap-2
                               text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 transition">
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                          <path d="M2 17l10 5 10-5"></path>
                          <path d="M2 12l10 5 10-5"></path>
                        </svg>
                        {{ 'COMMON.WIZARD' | translate }}
                      </button>
                    </div>
                  }
                </div>
              }
              <input #fileInputRef type="file" accept=".json" class="hidden" (change)="onFileSelected($event)" />
              <button (click)="selectItem('new')"
                class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-4 py-2 rounded-xl text-xs
                       hover:bg-slate-800 dark:hover:bg-gray-200 transition">
                + {{ 'COMMON.NEW' | translate }}
              </button>
            </div>
          </div>

          <!-- Import-Ergebnis -->
          @if (importResult()) {
            <div class="bg-slate-50 dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-lg p-4
                        text-sm space-y-1">
              <div class="flex items-center justify-between">
                <p class="font-medium text-slate-900 dark:text-white">{{ 'COMMON.IMPORT_COMPLETE' | translate }}</p>
                <div class="flex items-center gap-2">
                  @if (importResult()!.errors > 0) {
                    <button (click)="showErrorLog.set(true)"
                      class="text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition"
                      title="Fehlerdetails anzeigen">
                      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                           stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                    </button>
                  }
                  <button (click)="importResult.set(null); showErrorLog.set(false)"
                    class="text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-white text-xs transition">
                    ✕
                  </button>
                </div>
              </div>
              <p class="text-slate-500 dark:text-gray-400">
                {{ 'PRODUCT_GROUPS.TITLE' | translate }}: {{ importResult()!.groupsCreated }} {{ 'COMMON.CREATED' | translate }}, {{ importResult()!.groupsUpdated }} {{ 'COMMON.UPDATED' | translate }}
              </p>
              <p class="text-slate-500 dark:text-gray-400">
                {{ 'PRODUCTS.TITLE' | translate }}: {{ importResult()!.productsCreated }} {{ 'COMMON.CREATED' | translate }}, {{ importResult()!.productsUpdated }} {{ 'COMMON.UPDATED' | translate }}
              </p>
              @if (importResult()!.errors > 0) {
                <p class="text-red-500 dark:text-red-400">{{ 'COMMON.ERRORS' | translate }}: {{ importResult()!.errors }}</p>
              }
            </div>
          }

          <!-- Fehler-Log Popup -->
          @if (showErrorLog() && importResult()?.errorLogs?.length) {
            <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm"
                 role="button" tabindex="0"
                 (click)="showErrorLog.set(false)" (keydown.enter)="showErrorLog.set(false)">
              <div class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-2xl
                          max-w-2xl w-full mx-4 shadow-2xl max-h-[80vh] flex flex-col"
                   role="presentation"
                   (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()">
                <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-gray-800">
                  <p class="text-slate-900 dark:text-white font-medium">
                    {{ 'COMMON.IMPORT_ERRORS' | translate }} ({{ importResult()!.errorLogs.length }})
                  </p>
                  <button (click)="showErrorLog.set(false)"
                    class="text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-white transition">
                    ✕
                  </button>
                </div>
                <div class="overflow-y-auto p-5 space-y-2 text-xs font-mono">
                  @for (log of importResult()!.errorLogs; track $index) {
                    <div class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30 rounded-lg
                                p-3 text-red-700 dark:text-red-300 break-all">
                      {{ log }}
                    </div>
                  }
                </div>
              </div>
            </div>
          }

          <!-- Suchleiste mit Kommando-System -->
          <div class="relative">
            <div class="flex items-center flex-wrap gap-1.5 bg-white dark:bg-gray-900 border border-slate-200
                        dark:border-gray-800 rounded-lg px-3 py-2 focus-within:border-slate-900
                        dark:focus-within:border-white focus-within:ring-1 focus-within:ring-slate-900
                        dark:focus-within:ring-white transition min-h-[42px]"
                 role="presentation"
                 (click)="searchInput()?.nativeElement?.focus()" (keydown.enter)="searchInput()?.nativeElement?.focus()">
              <!-- Aktive Filter-Chips -->
              @for (filter of activeFilters(); track filter.key) {
                <span class="inline-flex items-center gap-1 bg-slate-100 dark:bg-gray-800 text-slate-700
                             dark:text-gray-300 text-xs font-medium px-2.5 py-1 rounded-lg">
                  <span class="text-slate-400 dark:text-gray-500">{{ filter.key }}:</span>
                  {{ filter.label }}
                  <button type="button" (click)="removeFilter(filter.key); $event.stopPropagation()"
                    class="text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-white ml-0.5
                           transition text-[10px]">
                    ✕
                  </button>
                </span>
              }
              <!-- Eingabefeld -->
              <input #searchInputRef type="text"
                [ngModel]="searchText()"
                (ngModelChange)="onSearchInput($event)"
                (keydown)="onSearchKeydown($event)"
                (focus)="onSearchFocus()"
                (blur)="onSearchBlur()"
                [placeholder]="activeFilters().length > 0 ? 'Weiter filtern...' : 'Suche... (/ für Kommandos)'"
                class="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-slate-900 dark:text-white
                       placeholder-slate-400 dark:placeholder-gray-600" />
            </div>

            <!-- Autocomplete Dropdown -->
            @if (showDropdown()) {
              <div class="absolute z-20 mt-1 w-full bg-white dark:bg-gray-900 border border-slate-200
                          dark:border-gray-700 rounded-lg shadow-xl overflow-hidden">
                @if (dropdownPhase() === 'command') {
                  @for (cmd of visibleCommands(); track cmd.key; let i = $index) {
                    <button type="button"
                      (mousedown)="selectCommand(cmd); $event.preventDefault()"
                      [class]="i === highlightIndex()
                        ? 'bg-slate-100 dark:bg-gray-800'
                        : 'hover:bg-slate-50 dark:hover:bg-gray-800/50'"
                      class="w-full px-3 py-2.5 flex items-center gap-3 text-left transition">
                      <span class="text-xs font-mono text-slate-500 dark:text-gray-400 bg-slate-100
                                   dark:bg-gray-800 px-1.5 py-0.5 rounded">{{ cmd.label }}</span>
                      <span class="text-sm text-slate-600 dark:text-gray-300">{{ cmd.description | translate }}</span>
                    </button>
                  }
                } @else {
                  @for (val of visibleValues(); track val.value; let i = $index) {
                    <button type="button"
                      (mousedown)="selectValue(val); $event.preventDefault()"
                      [class]="i === highlightIndex()
                        ? 'bg-slate-100 dark:bg-gray-800'
                        : 'hover:bg-slate-50 dark:hover:bg-gray-800/50'"
                      class="w-full px-3 py-2.5 text-left text-sm text-slate-700 dark:text-gray-300 transition">
                      {{ val.label | translate }}
                    </button>
                  }
                }
              </div>
            }
          </div>

          @if (filteredProducts().length === 0 && !loading()) {
            <p class="text-slate-400 dark:text-gray-500 text-center py-12 text-sm">
              {{ (products().length === 0 ? 'PRODUCTS.NO_PRODUCTS' : 'COMMON.NO_RESULTS') | translate }}
            </p>
          } @else {
            <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-slate-200 dark:border-gray-800 text-left text-slate-400 dark:text-gray-500
                             text-xs uppercase tracking-wider select-none">
                    <th class="px-3 py-2.5 cursor-pointer hover:text-slate-600 dark:hover:text-gray-300 transition-colors"
                        (click)="toggleSort('name')">
                      {{ 'COMMON.NAME' | translate }}{{ sortIcon('name') }}
                    </th>
                    @if (!selectedId()) {
                      <th class="px-3 py-2.5 cursor-pointer hover:text-slate-600 dark:hover:text-gray-300 transition-colors"
                          (click)="toggleSort('acronym')">
                        {{ 'PRODUCTS.ACRONYM' | translate }}{{ sortIcon('acronym') }}
                      </th>
                      <th class="px-3 py-2.5 cursor-pointer hover:text-slate-600 dark:hover:text-gray-300 transition-colors"
                          (click)="toggleSort('price')">
                        {{ 'PRODUCTS.PRICE' | translate }}{{ sortIcon('price') }}
                      </th>
                      <th class="px-3 py-2.5 cursor-pointer hover:text-slate-600 dark:hover:text-gray-300 transition-colors"
                          (click)="toggleSort('productType')">
                        {{ 'PRODUCTS.TYPE' | translate }}{{ sortIcon('productType') }}
                      </th>
                      <th class="px-3 py-2.5 cursor-pointer hover:text-slate-600 dark:hover:text-gray-300 transition-colors"
                          (click)="toggleSort('status')">
                        {{ 'COMMON.STATUS' | translate }}{{ sortIcon('status') }}
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (p of filteredProducts(); track p._id) {
                    <tr (click)="selectItem(p._id)"
                        [class]="p._id === selectedId()
                          ? 'bg-slate-100 dark:bg-white/5 border-l-2 border-l-slate-900 dark:border-l-white'
                          : 'hover:bg-slate-50 dark:hover:bg-gray-800/30 border-l-2 border-l-transparent'"
                        class="cursor-pointer border-b border-slate-200/50 dark:border-gray-800/50 transition">
                      <td class="px-3 py-2.5 font-medium truncate max-w-48">
                        <span class="inline-flex items-center gap-1.5">
                          <img [src]="productTypeIcon(p.productType)" alt="" class="w-4 h-4 shrink-0" />
                          {{ p.name }}
                          @if (p.icon) {
                            <span class="shrink-0">{{ p.icon }}</span>
                          }
                        </span>
                      </td>
                      @if (!selectedId()) {
                        <td class="px-3 py-2.5 text-slate-500 dark:text-gray-400 font-mono text-xs">{{ p.acronym }}</td>
                        <td class="px-3 py-2.5 font-mono text-xs">{{ (p.price || 0).toFixed(2) }} &euro;</td>
                        <td class="px-3 py-2.5">
                          <span class="text-xs px-2 py-0.5 rounded-full border border-slate-300 dark:border-gray-700
                                       text-slate-600 dark:text-gray-300">
                            {{ p.productType || 'PRODUCT' }}
                          </span>
                        </td>
                        <td class="px-3 py-2.5">
                          <span [class]="statusBadge(p.status)">{{ statusLabel(p.status) }}</span>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>

          }
        </div>
      </div>

      <!-- Rechte Seite: Side-Panel -->
      @if (selectedId()) {
        <div class="flex-1 flex flex-col overflow-hidden">
          <!-- Panel Header mit Navigation -->
          <div class="shrink-0 bg-slate-50 dark:bg-gray-950 border-b border-slate-200 dark:border-gray-800
                      px-4 py-2.5 flex items-center gap-2">
            <button (click)="prevItem()" [disabled]="currentIndex() <= 0"
              class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white
                     disabled:text-slate-300 dark:disabled:text-gray-700 disabled:cursor-not-allowed
                     w-8 h-8 flex items-center justify-center rounded-lg
                     hover:bg-slate-100 dark:hover:bg-gray-800 transition text-sm">
              ◀
            </button>
            <span class="text-xs text-slate-400 dark:text-gray-500 min-w-12 text-center">
              @if (selectedId() !== 'new') {
                {{ currentIndex() + 1 }} / {{ filteredProducts().length }}
              } @else {
                {{ 'COMMON.NEW' | translate }}
              }
            </span>
            <button (click)="nextItem()" [disabled]="currentIndex() >= filteredProducts().length - 1"
              class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white
                     disabled:text-slate-300 dark:disabled:text-gray-700 disabled:cursor-not-allowed
                     w-8 h-8 flex items-center justify-center rounded-lg
                     hover:bg-slate-100 dark:hover:bg-gray-800 transition text-sm">
              ▶
            </button>
            <div class="flex-1"></div>
            <button (click)="selectedId.set(null)"
              class="text-slate-400 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white w-8 h-8
                     flex items-center justify-center rounded-lg
                     hover:bg-slate-100 dark:hover:bg-gray-800 transition text-sm">
              ✕
            </button>
          </div>

          <!-- Formular -->
          <div class="flex-1 overflow-y-auto">
            <app-product-form #formRef
              [id]="selectedId()!"
              [panelMode]="true"
              (saved)="onItemSaved()"
              (closed)="tryClose()" />
          </div>
        </div>
      }

      <!-- Dirty-Check Dialog -->
      @if (pendingNavAction) {
        <app-confirm-dialog
          title="Ungespeicherte Änderungen"
          message="Möchten Sie die Änderungen speichern?"
          confirmLabel="Speichern"
          dismissLabel="Verwerfen"
          cancelLabel="Abbrechen"
          (confirmed)="onDialogSave()"
          (dismissed)="onDialogDiscard()"
          (cancelled)="onDialogCancel()" />
      }

      @if (showWizard()) {
        <app-product-wizard
          (saved)="onWizardSaved()"
          (cancelled)="showWizard.set(false)" />
      }
    </div>
  `,
})
export class ProductListComponent implements OnInit {
  private api = inject(ApiService)
  private t = inject(TranslateService)
  products = signal<any[]>([])
  productGroups = signal<{ _id: string; name: string; color: string }[]>([])
  loading = signal(true)
  totalProducts = signal(0)
  selectedId = signal<string | null>(null)

  private formRef = viewChild<ProductFormComponent>('formRef')
  searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInputRef')
  fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInputRef')
  showWizard = signal(false)
  actionsMenuOpen = signal(false)
  pendingNavAction: (() => void) | null = null

  // --- Export / Import ---
  exporting = signal(false)
  importing = signal(false)
  importResult = signal<{
    groupsCreated: number; groupsUpdated: number
    productsCreated: number; productsUpdated: number
    errors: number
    errorLogs: string[]
  } | null>(null)
  showErrorLog = signal(false)

  // --- Sortierung ---
  sortColumn = signal<string>('name')
  sortDirection = signal<'asc' | 'desc'>('asc')

  toggleSort(column: string) {
    if (this.sortColumn() === column) {
      this.sortDirection.update(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      this.sortColumn.set(column)
      this.sortDirection.set('asc')
    }
  }

  sortIcon(column: string): string {
    if (this.sortColumn() !== column) return ''
    return this.sortDirection() === 'asc' ? ' ▲' : ' ▼'
  }

  // --- Suchleiste ---
  searchText = signal('')
  activeFilters = signal<SearchFilter[]>([])
  showDropdown = signal(false)
  dropdownPhase = signal<'command' | 'value'>('command')
  pendingCommand = signal<SearchCommand | null>(null)
  highlightIndex = signal(0)

  commands = computed<SearchCommand[]>(() => [
    {
      key: 'typ',
      label: '/typ:',
      description: 'COMMON.FILTER_BY_TYPE',
      values: [
        { value: 'PRODUCT', label: 'PRODUCTS.TYPE_PRODUCT' },
        { value: 'MODIFIER', label: 'PRODUCTS.TYPE_MODIFIER' },
        { value: 'BUNDLE', label: 'PRODUCTS.TYPE_BUNDLE' },
      ],
    },
    {
      key: 'status',
      label: '/status:',
      description: 'COMMON.FILTER_BY_STATUS',
      values: [
        { value: 'ACTIVE', label: 'COMMON.STATUS_ACTIVE' },
        { value: 'DRAFT', label: 'COMMON.STATUS_DRAFT' },
        { value: 'ARCHIVED', label: 'COMMON.STATUS_ARCHIVED' },
      ],
    },
    {
      key: 'gruppe',
      label: '/gruppe:',
      description: 'PRODUCT_GROUPS.FILTER_BY_GROUP',
      values: this.productGroups().map(g => ({ value: g._id, label: g.name })),
    },
  ])

  /** Nur Kommandos zeigen, die noch nicht aktiv sind */
  visibleCommands = computed(() => {
    const active = new Set(this.activeFilters().map(f => f.key))
    return this.commands().filter(c => !active.has(c.key))
  })

  /** Werte des aktuell ausgewaehlten Kommandos */
  visibleValues = computed(() => this.pendingCommand()?.values ?? [])

  /** Gefilterte Produktliste */
  filteredProducts = computed(() => {
    let list = this.products()

    // Kommando-Filter anwenden
    for (const f of this.activeFilters()) {
      if (f.key === 'typ') list = list.filter(p => p.productType === f.value)
      if (f.key === 'status') list = list.filter(p => p.status === f.value)
      if (f.key === 'gruppe') list = list.filter(p => Array.isArray(p.categoryIds) && p.categoryIds.includes(f.value))
    }

    // Freitext-Filter (ueber den aktuellen searchText, ohne /-Praefix)
    const q = this.freitextQuery().toLowerCase().trim()
    if (q) {
      list = list.filter(
        p =>
          p.name?.toLowerCase().includes(q) ||
          p.acronym?.toLowerCase().includes(q) ||
          String(p.price).includes(q),
      )
    }

    // Sortierung
    const col = this.sortColumn()
    const dir = this.sortDirection() === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      const va = a[col] ?? ''
      const vb = b[col] ?? ''
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'de') * dir
    })

    return list
  })

  /** Freitext-Anteil des Suchstrings (ohne /-Kommando) */
  private freitextQuery = computed(() => {
    const text = this.searchText()
    if (text.startsWith('/')) return ''
    return text
  })

  currentIndex = computed(() => {
    const id = this.selectedId()
    if (!id || id === 'new') return -1
    return this.filteredProducts().findIndex(p => p._id === id)
  })

  // --- Suchleiste Event-Handler ---

  onSearchInput(value: string) {
    this.searchText.set(value)
    if (value.startsWith('/')) {
      this.showDropdown.set(true)
      this.dropdownPhase.set('command')
      this.highlightIndex.set(0)
    } else if (this.dropdownPhase() === 'command') {
      this.showDropdown.set(false)
    }
  }

  onSearchFocus() {
    if (this.searchText().startsWith('/')) {
      this.showDropdown.set(true)
    }
  }

  onSearchBlur() {
    // Kurze Verzoegerung damit mousedown-Events auf Dropdown-Items noch feuern
    setTimeout(() => this.showDropdown.set(false), 150)
  }

  onSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.showDropdown.set(false)
      if (this.searchText().startsWith('/')) this.searchText.set('')
      return
    }

    if (event.key === 'Backspace' && !this.searchText()) {
      // Letzten Filter-Chip entfernen
      const filters = this.activeFilters()
      if (filters.length > 0) {
        this.activeFilters.set(filters.slice(0, -1))
      }
      return
    }

    if (!this.showDropdown()) {
      if (event.key === '/' && !this.searchText()) {
        event.preventDefault()
        this.searchText.set('/')
        this.showDropdown.set(true)
        this.dropdownPhase.set('command')
        this.highlightIndex.set(0)
      }
      return
    }

    const items =
      this.dropdownPhase() === 'command' ? this.visibleCommands() : this.visibleValues()
    const maxIdx = items.length - 1

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.highlightIndex.update(i => Math.min(i + 1, maxIdx))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.highlightIndex.update(i => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const idx = this.highlightIndex()
      if (this.dropdownPhase() === 'command') {
        const cmd = this.visibleCommands()[idx]
        if (cmd) this.selectCommand(cmd)
      } else {
        const val = this.visibleValues()[idx]
        if (val) this.selectValue(val)
      }
    }
  }

  selectCommand(cmd: SearchCommand) {
    this.pendingCommand.set(cmd)
    this.dropdownPhase.set('value')
    this.highlightIndex.set(0)
    this.searchText.set('')
  }

  selectValue(val: { value: string; label: string }) {
    const cmd = this.pendingCommand()
    if (!cmd) return

    // Label übersetzen (i18n-Keys werden aufgelöst, direkte Strings bleiben unverändert)
    const resolvedLabel = this.t.instant(val.label)

    this.activeFilters.update(filters => [
      ...filters.filter(f => f.key !== cmd.key),
      { key: cmd.key, value: val.value, label: resolvedLabel },
    ])

    this.pendingCommand.set(null)
    this.dropdownPhase.set('command')
    this.showDropdown.set(false)
    this.searchText.set('')
    this.highlightIndex.set(0)
  }

  removeFilter(key: string) {
    this.activeFilters.update(filters => filters.filter(f => f.key !== key))
  }

  // --- Status-Badges ---

  productTypeIcon(type: string): string {
    switch (type) {
      case 'MODIFIER': return 'assets/icons/icon-modifier.svg'
      case 'BUNDLE': return 'assets/icons/icon-bundle.svg'
      default: return 'assets/icons/icon-product.svg'
    }
  }

  statusBadge(status: string): string {
    const base = 'text-xs px-2.5 py-0.5 rounded-full border'
    switch (status) {
      case 'ACTIVE':
        return `${base} bg-green-500/10 text-green-400 border-green-500/20`
      case 'DRAFT':
        return `${base} bg-yellow-500/10 text-yellow-400 border-yellow-500/20`
      case 'ARCHIVED':
        return `${base} bg-gray-500/10 text-gray-400 border-gray-500/20`
      default:
        return `${base} bg-gray-500/10 text-gray-400 border-gray-500/20`
    }
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      ACTIVE: 'COMMON.STATUS_ACTIVE',
      DRAFT: 'COMMON.STATUS_DRAFT',
      ARCHIVED: 'COMMON.STATUS_ARCHIVED',
    }
    return map[status] ? this.t.instant(map[status]) : status
  }

  // --- Navigation mit Dirty-Check ---

  private navigateWithDirtyCheck(action: () => void) {
    const form = this.formRef()
    if (form?.isDirty()) {
      this.pendingNavAction = action
    } else {
      action()
    }
  }

  selectItem(id: string) {
    this.navigateWithDirtyCheck(() => this.selectedId.set(id))
  }

  prevItem() {
    const idx = this.currentIndex()
    if (idx > 0)
      this.navigateWithDirtyCheck(() =>
        this.selectedId.set(this.filteredProducts()[idx - 1]._id),
      )
  }

  nextItem() {
    const idx = this.currentIndex()
    if (idx < this.filteredProducts().length - 1)
      this.navigateWithDirtyCheck(() =>
        this.selectedId.set(this.filteredProducts()[idx + 1]._id),
      )
  }

  tryClose() {
    this.navigateWithDirtyCheck(() => this.selectedId.set(null))
  }

  // --- Dialog-Handler ---

  async onDialogSave() {
    const form = this.formRef()
    if (form) {
      const ok = await form.saveAndContinue()
      if (ok) {
        await this.loadProducts()
        this.pendingNavAction?.()
      }
    }
    this.pendingNavAction = null
  }

  onDialogDiscard() {
    this.formRef()?.discardChanges()
    this.pendingNavAction?.()
    this.pendingNavAction = null
  }

  onDialogCancel() {
    this.pendingNavAction = null
  }

  async onItemSaved() {
    await this.loadProducts()
  }

  async onWizardSaved() {
    this.showWizard.set(false)
    await this.loadProducts()
  }

  async ngOnInit() {
    await Promise.all([
      this.loadProducts(),
      this.loadProductGroups(),
    ])
  }

  private async loadProductGroups() {
    try {
      const result = await this.api.find<{ _id: string; name: string; color: string }>('product-groups', { $limit: 250 })
      this.productGroups.set(result.data)
    } catch (e) {
      console.error('Fehler beim Laden der Produktgruppen:', e)
    }
  }

  /** Lädt alle Produkte seitenweise (max 250 pro Seite, parallele Requests) */
  private async loadProducts() {
    const PAGE_SIZE = 250
    try {
      const first = await this.api.find<any>('products', {
        $limit: PAGE_SIZE,
        $skip: 0,
        $sort: { name: 1 },
      })

      const all = [...first.data]

      if (first.total > PAGE_SIZE) {
        const pages = Math.ceil(first.total / PAGE_SIZE)
        const remaining = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) =>
            this.api.find<any>('products', {
              $limit: PAGE_SIZE,
              $skip: (i + 1) * PAGE_SIZE,
              $sort: { name: 1 },
            }),
          ),
        )
        for (const page of remaining) {
          all.push(...page.data)
        }
      }

      this.totalProducts.set(first.total)
      this.products.set(all)
    } catch (e) {
      console.error('Fehler beim Laden der Produkte:', e)
    }
    this.loading.set(false)
  }

  // --- Export ---

  async onExport() {
    this.exporting.set(true)
    try {
      const [productsResult, groupsResult] = await Promise.all([
        this.api.find<any>('products', { $limit: 500 }),
        this.api.find<any>('product-groups', { $limit: 200 }),
      ])

      const groups = groupsResult.data
      const products = productsResult.data

      // Mapping: _id → externalId fuer Gruppen und Produkte
      const groupIdToExternal = new Map<string, string>()
      for (const g of groups) {
        if (g._id && g.externalId) groupIdToExternal.set(g._id, g.externalId)
      }
      const productIdToExternal = new Map<string, string>()
      for (const p of products) {
        if (p._id && p.externalId) productIdToExternal.set(p._id, p.externalId)
      }

      const stripSystemFields = (item: any) => {
        const { _id, tenantId, locationId, createdAt, updatedAt, ...rest } = item
        return this.sanitizeForExport(rest)
      }

      // Produktgruppen exportieren
      const exportedGroups = groups.map(stripSystemFields)

      // Produkte exportieren: categoryIds → externalIds, optionGroups productIds → externalIds
      const exportedProducts = products.map((p: any) => {
        const cleaned = stripSystemFields(p)

        // categoryIds auf externalIds mappen
        if (Array.isArray(cleaned.categoryIds)) {
          cleaned.categoryExternalIds = cleaned.categoryIds
            .map((id: string) => groupIdToExternal.get(id))
            .filter(Boolean)
          delete cleaned.categoryIds
        }

        // optionGroups: productId → productExternalId
        if (Array.isArray(cleaned.optionGroups)) {
          cleaned.optionGroups = cleaned.optionGroups.map((og: any) => ({
            ...og,
            options: og.options?.map((opt: any) => {
              const { productId, ...optRest } = opt
              return {
                ...optRest,
                productExternalId: productIdToExternal.get(productId) || productId,
              }
            }),
          }))
        }

        return cleaned
      })

      const exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        source: 'panary-core-admin',
        productGroups: exportedGroups,
        products: exportedProducts,
      }

      // Download als JSON-Datei
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `panary-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Export fehlgeschlagen:', e)
    }
    this.exporting.set(false)
  }

  // --- Import ---

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    input.value = '' // Zuruecksetzen fuer erneutes Auswaehlen der gleichen Datei

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        this.runImport(data)
      } catch {
        console.error('Ungueltige JSON-Datei')
      }
    }
    reader.readAsText(file)
  }

  private async runImport(data: any) {
    if (!data.version || !Array.isArray(data.productGroups) || !Array.isArray(data.products)) {
      console.error('Ungueltiges Import-Format')
      return
    }

    this.importing.set(true)
    this.importResult.set(null)

    const result = { groupsCreated: 0, groupsUpdated: 0, productsCreated: 0, productsUpdated: 0, errors: 0, errorLogs: [] as string[] }

    // Phase 1: Produktgruppen importieren
    const groupExternalToId = new Map<string, string>()

    // Bestehende Gruppen laden fuer externalId-Lookup
    try {
      const existing = await this.api.find<any>('product-groups', { $limit: 200 })
      for (const g of existing.data) {
        if (g.externalId) groupExternalToId.set(g.externalId, g._id)
      }
    } catch { /* ignore */ }

    for (const group of data.productGroups) {
      try {
        const existingId = group.externalId ? groupExternalToId.get(group.externalId) : null
        if (existingId) {
          await this.api.patch('product-groups', existingId, group)
          groupExternalToId.set(group.externalId, existingId)
          result.groupsUpdated++
        } else {
          const created = await this.api.create<any>('product-groups', group)
          if (group.externalId) groupExternalToId.set(group.externalId, created._id)
          result.groupsCreated++
        }
      } catch (e: any) {
        result.errors++
        result.errorLogs.push(this.formatImportError(`Produktgruppe: ${group.name || group.externalId}`, e))
      }
    }

    // Phase 2: Produkte importieren (ohne optionGroups, um Querverweise zu vermeiden)
    const productExternalToId = new Map<string, string>()

    // Bestehende Produkte laden
    try {
      const existing = await this.api.find<any>('products', { $limit: 500 })
      for (const p of existing.data) {
        if (p.externalId) productExternalToId.set(p.externalId, p._id)
      }
    } catch { /* ignore */ }

    // Produkte mit aufgeloesten categoryIds erstellen/aktualisieren
    const productsWithOptionGroups: { id: string; optionGroups: any[] }[] = []

    for (const product of data.products) {
      try {
        const { categoryExternalIds, optionGroups, ...productData } = product

        // categoryExternalIds → lokale categoryIds
        if (Array.isArray(categoryExternalIds)) {
          productData.categoryIds = categoryExternalIds
            .map((eid: string) => groupExternalToId.get(eid))
            .filter(Boolean)
        }

        const existingId = productData.externalId ? productExternalToId.get(productData.externalId) : null

        let savedId: string
        if (existingId) {
          await this.api.patch('products', existingId, productData)
          savedId = existingId
          result.productsUpdated++
        } else {
          const created = await this.api.create<any>('products', productData)
          savedId = created._id
          if (productData.externalId) productExternalToId.set(productData.externalId, savedId)
          result.productsCreated++
        }

        // optionGroups fuer Phase 3 merken
        if (Array.isArray(optionGroups) && optionGroups.length > 0) {
          productsWithOptionGroups.push({ id: savedId, optionGroups })
        }
      } catch (e: any) {
        result.errors++
        result.errorLogs.push(this.formatImportError(`Produkt: ${product.name || product.externalId}`, e))
      }
    }

    // Phase 3: optionGroups mit aufgeloesten productIds patchen
    for (const { id, optionGroups } of productsWithOptionGroups) {
      try {
        const resolved = optionGroups.map((og: any) => ({
          ...og,
          options: og.options?.map((opt: any) => {
            const { productExternalId, ...optRest } = opt
            return {
              ...optRest,
              productId: productExternalToId.get(productExternalId) || productExternalId,
            }
          }),
        }))
        await this.api.patch('products', id, { optionGroups: resolved })
      } catch (e: any) {
        result.errors++
        result.errorLogs.push(this.formatImportError(`OptionGroups: Produkt ${id}`, e))
      }
    }

    this.importResult.set(result)
    this.importing.set(false)
    await this.loadProducts()
  }

  /** Felder die in SQLite als 0/1 gespeichert werden, aber Boolean sein muessen */
  private static readonly BOOLEAN_FIELDS = new Set([
    'excluded', 'isInvalid', 'isDefault', 'isActive', 'isRemovable',
    'showOptionsAuto', 'hideOnMainScreen', 'onlyOutsideConsumption',
    'isPosUser', 'allowStaffMealOrders',
  ])

  /** Bereinigt Export-Daten: entfernt null-Werte, korrigiert SQLite-Integer-Booleans */
  private sanitizeForExport(obj: any): any {
    if (Array.isArray(obj)) return obj.map(item => this.sanitizeForExport(item))
    if (obj && typeof obj === 'object') {
      const cleaned: any = {}
      for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) continue
        if (ProductListComponent.BOOLEAN_FIELDS.has(key)) {
          cleaned[key] = !!value
        } else {
          cleaned[key] = this.sanitizeForExport(value)
        }
      }
      return cleaned
    }
    return obj
  }

  /** Extrahiert detaillierte Fehlermeldung aus der Backend-Antwort */
  private formatImportError(name: string, e: any): string {
    const base = `"${name}"`
    const msg = e?.error?.message || e?.message || 'Unbekannter Fehler'

    // Validierungsdetails aus der Feathers-Antwort extrahieren
    const details = e?.error?.data
    if (Array.isArray(details) && details.length > 0) {
      const fields = details.map((d: any) => `${d.instancePath || '?'}: ${d.message}`).join(', ')
      return `${base}: ${msg} (${fields})`
    }

    return `${base}: ${msg}`
  }
}
