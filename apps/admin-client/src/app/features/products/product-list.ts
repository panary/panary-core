import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit, viewChild, ElementRef } from '@angular/core'
import { FormsModule } from '@angular/forms'
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
  imports: [ProductFormComponent, ConfirmDialogComponent, FormsModule, ProductWizardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full">
      <!-- Linke Seite: Tabelle -->
      <div [class]="selectedId() ? 'w-72 shrink-0 border-r border-slate-200 dark:border-gray-800' : 'flex-1'"
           class="overflow-y-auto transition-all">
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between">
            <h1 class="text-xl font-bold tracking-tight">Produkte</h1>
            <div class="flex items-center gap-2">
              <button (click)="onExport()"
                class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white text-xs
                       px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800
                       hover:bg-slate-50 dark:hover:bg-gray-800 transition"
                [disabled]="exporting()">
                {{ exporting() ? 'Exportiere...' : 'Export' }}
              </button>
              <button (click)="fileInput()?.nativeElement?.click()"
                class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white text-xs
                       px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800
                       hover:bg-slate-50 dark:hover:bg-gray-800 transition"
                [disabled]="importing()">
                {{ importing() ? 'Importiere...' : 'Import' }}
              </button>
              <input #fileInputRef type="file" accept=".json" class="hidden" (change)="onFileSelected($event)" />
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
                Assistent
              </button>
              <button (click)="selectItem('new')"
                class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-4 py-2 rounded-xl text-xs
                       hover:bg-slate-800 dark:hover:bg-gray-200 transition">
                + Neu
              </button>
            </div>
          </div>

          <!-- Import-Ergebnis -->
          @if (importResult()) {
            <div class="bg-slate-50 dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-lg p-4
                        text-sm space-y-1">
              <div class="flex items-center justify-between">
                <p class="font-medium text-slate-900 dark:text-white">Import abgeschlossen</p>
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
                Produktgruppen: {{ importResult()!.groupsCreated }} erstellt, {{ importResult()!.groupsUpdated }} aktualisiert
              </p>
              <p class="text-slate-500 dark:text-gray-400">
                Produkte: {{ importResult()!.productsCreated }} erstellt, {{ importResult()!.productsUpdated }} aktualisiert
              </p>
              @if (importResult()!.errors > 0) {
                <p class="text-red-500 dark:text-red-400">Fehler: {{ importResult()!.errors }}</p>
              }
            </div>
          }

          <!-- Fehler-Log Popup -->
          @if (showErrorLog() && importResult()?.errorLogs?.length) {
            <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm"
                 (click)="showErrorLog.set(false)">
              <div class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-2xl
                          max-w-2xl w-full mx-4 shadow-2xl max-h-[80vh] flex flex-col"
                   (click)="$event.stopPropagation()">
                <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-gray-800">
                  <p class="text-slate-900 dark:text-white font-medium">
                    Import-Fehler ({{ importResult()!.errorLogs.length }})
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
                 (click)="searchInput()?.nativeElement?.focus()">
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
                      <span class="text-sm text-slate-600 dark:text-gray-300">{{ cmd.description }}</span>
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
                      {{ val.label }}
                    </button>
                  }
                }
              </div>
            }
          </div>

          @if (filteredProducts().length === 0 && !loading()) {
            <p class="text-slate-400 dark:text-gray-500 text-center py-12 text-sm">
              {{ products().length === 0 ? 'Keine Produkte' : 'Keine Treffer' }}
            </p>
          } @else {
            <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-slate-200 dark:border-gray-800 text-left text-slate-400 dark:text-gray-500
                             text-xs uppercase tracking-wider">
                    <th class="px-3 py-2.5">Name</th>
                    @if (!selectedId()) {
                      <th class="px-3 py-2.5">Kürzel</th>
                      <th class="px-3 py-2.5">Preis</th>
                      <th class="px-3 py-2.5">Typ</th>
                      <th class="px-3 py-2.5">Status</th>
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
                      <td class="px-3 py-2.5 font-medium truncate max-w-48">{{ p.name }}</td>
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
                Neu
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
  products = signal<any[]>([])
  loading = signal(true)
  selectedId = signal<string | null>(null)

  private formRef = viewChild<ProductFormComponent>('formRef')
  searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInputRef')
  fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInputRef')
  showWizard = signal(false)
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

  // --- Suchleiste ---
  searchText = signal('')
  activeFilters = signal<SearchFilter[]>([])
  showDropdown = signal(false)
  dropdownPhase = signal<'command' | 'value'>('command')
  pendingCommand = signal<SearchCommand | null>(null)
  highlightIndex = signal(0)

  readonly commands: SearchCommand[] = [
    {
      key: 'typ',
      label: '/typ:',
      description: 'Nach Produkttyp filtern',
      values: [
        { value: 'PRODUCT', label: 'Produkt' },
        { value: 'MODIFIER', label: 'Modifier' },
        { value: 'BUNDLE', label: 'Menü' },
      ],
    },
    {
      key: 'status',
      label: '/status:',
      description: 'Nach Status filtern',
      values: [
        { value: 'ACTIVE', label: 'Aktiv' },
        { value: 'DRAFT', label: 'Entwurf' },
        { value: 'ARCHIVED', label: 'Archiviert' },
      ],
    },
  ]

  /** Nur Kommandos zeigen, die noch nicht aktiv sind */
  visibleCommands = computed(() => {
    const active = new Set(this.activeFilters().map(f => f.key))
    return this.commands.filter(c => !active.has(c.key))
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

    this.activeFilters.update(filters => [
      ...filters.filter(f => f.key !== cmd.key),
      { key: cmd.key, value: val.value, label: val.label },
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
      ACTIVE: 'Aktiv',
      DRAFT: 'Entwurf',
      ARCHIVED: 'Archiviert',
    }
    return map[status] || status
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
    await this.loadProducts()
  }

  private static readonly TYPE_ORDER: Record<string, number> = { PRODUCT: 0, BUNDLE: 1, MODIFIER: 2 }

  private async loadProducts() {
    try {
      const result = await this.api.find<any>('products', { $limit: 200 })
      const sorted = result.data.sort((a: any, b: any) => {
        const ta = ProductListComponent.TYPE_ORDER[a.productType] ?? 9
        const tb = ProductListComponent.TYPE_ORDER[b.productType] ?? 9
        if (ta !== tb) return ta - tb
        return (a.name || '').localeCompare(b.name || '')
      })
      this.products.set(sorted)
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
