import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit, viewChild, ElementRef } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ApiService } from '../../core/api.service'
import { GroupFormComponent } from './group-form'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'
import { GroupWizardComponent } from './group-wizard'

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
  imports: [GroupFormComponent, ConfirmDialogComponent, FormsModule, GroupWizardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full overflow-hidden">
      <!-- Linke Seite: Tabelle -->
      <div [class]="selectedId() ? 'w-72 shrink-0 border-r border-slate-200 dark:border-gray-800' : 'flex-1'"
           class="overflow-y-auto">
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between min-h-9">
            <h1 class="text-xl font-bold tracking-tight">Produktgruppen</h1>
            <div class="flex items-center gap-2">
              @if (!selectedId()) {
                <!-- Alle Buttons sichtbar wenn kein Panel -->
                <button (click)="onExport()" [disabled]="exporting()"
                  class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white text-xs
                         px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800
                         hover:bg-slate-50 dark:hover:bg-gray-800 transition">
                  {{ exporting() ? 'Exportiere...' : 'Export' }}
                </button>
                <button (click)="fileInput()?.nativeElement?.click()" [disabled]="importing()"
                  class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white text-xs
                         px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800
                         hover:bg-slate-50 dark:hover:bg-gray-800 transition">
                  {{ importing() ? 'Importiere...' : 'Import' }}
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
                  Assistent
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
                    <div class="fixed inset-0 z-40" (click)="actionsMenuOpen.set(false)"></div>
                    <div class="absolute right-0 top-full mt-1 z-50 w-44
                                bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800
                                rounded-xl shadow-xl p-1 flex flex-col gap-0.5">
                      <button (click)="onExport(); actionsMenuOpen.set(false)" [disabled]="exporting()"
                        class="w-full text-left text-xs px-3 py-2 rounded-lg
                               text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 transition
                               disabled:opacity-50">
                        {{ exporting() ? 'Exportiere...' : 'Export' }}
                      </button>
                      <button (click)="fileInput()?.nativeElement?.click(); actionsMenuOpen.set(false)" [disabled]="importing()"
                        class="w-full text-left text-xs px-3 py-2 rounded-lg
                               text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 transition
                               disabled:opacity-50">
                        {{ importing() ? 'Importiere...' : 'Import' }}
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
                        Assistent
                      </button>
                    </div>
                  }
                </div>
              }
              <input #fileInputRef type="file" accept=".json" class="hidden" (change)="onFileSelected($event)" />
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
                Erstellt: {{ importResult()!.created }}, Aktualisiert: {{ importResult()!.updated }}
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

          <!-- Suchleiste -->
          <div class="relative">
            <div class="flex items-center flex-wrap gap-1.5 bg-white dark:bg-gray-900 border border-slate-200
                        dark:border-gray-800 rounded-lg px-3 py-2 focus-within:border-slate-900
                        dark:focus-within:border-white focus-within:ring-1 focus-within:ring-slate-900
                        dark:focus-within:ring-white transition min-h-[42px]"
                 (click)="searchInputEl()?.nativeElement?.focus()">
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

          @if (loading()) {
            <p class="text-slate-400 dark:text-gray-500 text-sm">Laden...</p>
          } @else if (filteredGroups().length === 0) {
            <p class="text-slate-400 dark:text-gray-500 text-center py-12 text-sm">
              {{ groups().length === 0 ? 'Keine Produktgruppen' : 'Keine Treffer' }}
            </p>
          } @else {
            <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-slate-200 dark:border-gray-800 text-left text-slate-400 dark:text-gray-500
                             text-xs uppercase tracking-wider">
                    <th class="px-3 py-2.5 w-8"></th>
                    <th class="px-3 py-2.5">Name</th>
                    @if (!selectedId()) {
                      <th class="px-3 py-2.5">Kürzel</th>
                      <th class="px-3 py-2.5">MwSt.</th>
                      <th class="px-3 py-2.5">Status</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (group of filteredGroups(); track group._id) {
                    <tr (click)="selectItem(group._id)"
                        [class]="group._id === selectedId()
                          ? 'bg-slate-100 dark:bg-white/5 border-l-2 border-l-slate-900 dark:border-l-white'
                          : 'hover:bg-slate-50 dark:hover:bg-gray-800/30 border-l-2 border-l-transparent'"
                        class="cursor-pointer border-b border-slate-200/50 dark:border-gray-800/50 transition">
                      <td class="px-3 py-2.5">
                        <span class="inline-block w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-gray-700"
                              [style.background-color]="group.color"></span>
                      </td>
                      <td class="px-3 py-2.5 font-medium truncate max-w-40">{{ group.name }}</td>
                      @if (!selectedId()) {
                        <td class="px-3 py-2.5 text-slate-500 dark:text-gray-400 font-mono text-xs">{{ group.acronym }}</td>
                        <td class="px-3 py-2.5 text-slate-500 dark:text-gray-400 text-xs">{{ group.taxInside }}%</td>
                        <td class="px-3 py-2.5">
                          <span [class]="statusBadge(group.status)">{{ statusLabel(group.status) }}</span>
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
                {{ currentIndex() + 1 }} / {{ filteredGroups().length }}
              } @else {
                Neu
              }
            </span>
            <button (click)="nextItem()" [disabled]="currentIndex() >= filteredGroups().length - 1"
              class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white
                     disabled:text-slate-300 dark:disabled:text-gray-700 disabled:cursor-not-allowed
                     w-8 h-8 flex items-center justify-center rounded-lg
                     hover:bg-slate-100 dark:hover:bg-gray-800 transition text-sm">
              ▶
            </button>
            <div class="flex-1"></div>
            <button (click)="tryClose()"
              class="text-slate-400 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white w-8 h-8
                     flex items-center justify-center rounded-lg
                     hover:bg-slate-100 dark:hover:bg-gray-800 transition text-sm">
              ✕
            </button>
          </div>

          <!-- Formular -->
          <div class="flex-1 overflow-y-auto">
            <app-group-form #formRef
              [id]="selectedId()!"
              [panelMode]="true"
              (saved)="onItemSaved()"
              (closed)="tryClose()" />
          </div>
        </div>
      }

      @if (pendingNavAction) {
        <app-confirm-dialog
          (confirmed)="onDialogSave()"
          (dismissed)="onDialogDiscard()"
          (cancelled)="onDialogCancel()" />
      }

      @if (showWizard()) {
        <app-group-wizard
          (saved)="onWizardSaved()"
          (cancelled)="showWizard.set(false)" />
      }
    </div>
  `,
})
export class GroupListComponent implements OnInit {
  private api = inject(ApiService)
  groups = signal<ProductGroup[]>([])
  loading = signal(true)
  selectedId = signal<string | null>(null)

  private formRef = viewChild<GroupFormComponent>('formRef')
  fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInputRef')
  searchInputEl = viewChild<ElementRef<HTMLInputElement>>('searchInputRef')
  showWizard = signal(false)
  actionsMenuOpen = signal(false)
  pendingNavAction: (() => void) | null = null

  // --- Suchleiste ---
  searchText = signal('')
  activeFilters = signal<SearchFilter[]>([])
  showDropdown = signal(false)
  dropdownPhase = signal<'command' | 'value'>('command')
  pendingCommandFilter = signal<SearchCommand | null>(null)
  highlightIndex = signal(0)

  readonly commands: SearchCommand[] = [
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

  visibleCommands = computed(() => {
    const active = new Set(this.activeFilters().map(f => f.key))
    return this.commands.filter(c => !active.has(c.key))
  })

  visibleValues = computed(() => this.pendingCommandFilter()?.values ?? [])

  filteredGroups = computed(() => {
    let list = this.groups()
    for (const f of this.activeFilters()) {
      if (f.key === 'status') list = list.filter(g => g.status === f.value)
    }
    const q = this.searchText().toLowerCase().trim()
    if (q && !q.startsWith('/')) {
      list = list.filter(g =>
        g.name?.toLowerCase().includes(q) ||
        g.acronym?.toLowerCase().includes(q),
      )
    }
    return list
  })

  exporting = signal(false)
  importing = signal(false)
  importResult = signal<{
    created: number; updated: number; errors: number; errorLogs: string[]
  } | null>(null)
  showErrorLog = signal(false)

  private static readonly BOOLEAN_FIELDS = new Set(['excluded'])

  currentIndex = computed(() => {
    const id = this.selectedId()
    if (!id || id === 'new') return -1
    return this.filteredGroups().findIndex(g => g._id === id)
  })

  statusBadge(status: string): string {
    const base = 'text-xs px-2.5 py-0.5 rounded-full border'
    switch (status) {
      case 'ACTIVE': return `${base} bg-green-500/10 text-green-400 border-green-500/20`
      case 'DRAFT': return `${base} bg-yellow-500/10 text-yellow-400 border-yellow-500/20`
      case 'ARCHIVED': return `${base} bg-gray-500/10 text-gray-400 border-gray-500/20`
      default: return `${base} bg-gray-500/10 text-gray-400 border-gray-500/20`
    }
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = { ACTIVE: 'Aktiv', DRAFT: 'Entwurf', ARCHIVED: 'Archiviert' }
    return map[status] || status
  }

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
    if (idx > 0) this.navigateWithDirtyCheck(() => this.selectedId.set(this.filteredGroups()[idx - 1]._id))
  }

  nextItem() {
    const idx = this.currentIndex()
    if (idx < this.filteredGroups().length - 1) this.navigateWithDirtyCheck(() => this.selectedId.set(this.filteredGroups()[idx + 1]._id))
  }

  tryClose() {
    this.navigateWithDirtyCheck(() => this.selectedId.set(null))
  }

  async onDialogSave() {
    const form = this.formRef()
    if (form) {
      const ok = await form.saveAndContinue()
      if (ok) {
        await this.loadGroups()
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
    await this.loadGroups()
  }

  async onWizardSaved() {
    this.showWizard.set(false)
    await this.loadGroups()
  }

  async ngOnInit() {
    await this.loadGroups()
  }

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
    if (this.searchText().startsWith('/')) this.showDropdown.set(true)
  }

  onSearchBlur() {
    setTimeout(() => this.showDropdown.set(false), 150)
  }

  onSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.showDropdown.set(false)
      if (this.searchText().startsWith('/')) this.searchText.set('')
      return
    }
    if (event.key === 'Backspace' && !this.searchText()) {
      const filters = this.activeFilters()
      if (filters.length > 0) this.activeFilters.set(filters.slice(0, -1))
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
    const items = this.dropdownPhase() === 'command' ? this.visibleCommands() : this.visibleValues()
    if (event.key === 'ArrowDown') { event.preventDefault(); this.highlightIndex.update(i => Math.min(i + 1, items.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.highlightIndex.update(i => Math.max(i - 1, 0)) }
    else if (event.key === 'Enter') {
      event.preventDefault()
      const idx = this.highlightIndex()
      if (this.dropdownPhase() === 'command') { const cmd = this.visibleCommands()[idx]; if (cmd) this.selectCommand(cmd) }
      else { const val = this.visibleValues()[idx]; if (val) this.selectValue(val) }
    }
  }

  selectCommand(cmd: SearchCommand) {
    this.pendingCommandFilter.set(cmd)
    this.dropdownPhase.set('value')
    this.highlightIndex.set(0)
    this.searchText.set('')
  }

  selectValue(val: { value: string; label: string }) {
    const cmd = this.pendingCommandFilter()
    if (!cmd) return
    this.activeFilters.update(filters => [...filters.filter(f => f.key !== cmd.key), { key: cmd.key, value: val.value, label: val.label }])
    this.pendingCommandFilter.set(null)
    this.dropdownPhase.set('command')
    this.showDropdown.set(false)
    this.searchText.set('')
    this.highlightIndex.set(0)
  }

  removeFilter(key: string) {
    this.activeFilters.update(filters => filters.filter(f => f.key !== key))
  }

  private async loadGroups() {
    try {
      const result = await this.api.find<ProductGroup>('product-groups', { $limit: 100 })
      this.groups.set(result.data)
    } catch (e) {
      console.error('Fehler beim Laden der Produktgruppen:', e)
    }
    this.loading.set(false)
  }

  // --- Export ---

  async onExport() {
    this.exporting.set(true)
    try {
      const result = await this.api.find<any>('product-groups', { $limit: 200 })
      const exported = result.data.map((g: any) => {
        const { _id, tenantId, locationId, createdAt, updatedAt, ...rest } = g
        return this.sanitize(rest)
      })

      const exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        source: 'panary-core-admin',
        productGroups: exported,
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `panary-produktgruppen-${new Date().toISOString().slice(0, 10)}.json`
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
    input.value = ''

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
    if (!data.version || !Array.isArray(data.productGroups)) {
      console.error('Ungueltiges Import-Format')
      return
    }

    this.importing.set(true)
    this.importResult.set(null)
    const result = { created: 0, updated: 0, errors: 0, errorLogs: [] as string[] }

    // Bestehende Gruppen laden
    const externalToId = new Map<string, string>()
    try {
      const existing = await this.api.find<any>('product-groups', { $limit: 200 })
      for (const g of existing.data) {
        if (g.externalId) externalToId.set(g.externalId, g._id)
      }
    } catch { /* ignore */ }

    for (const group of data.productGroups) {
      try {
        const existingId = group.externalId ? externalToId.get(group.externalId) : null
        if (existingId) {
          await this.api.patch('product-groups', existingId, group)
          result.updated++
        } else {
          await this.api.create('product-groups', group)
          result.created++
        }
      } catch (e: any) {
        result.errors++
        result.errorLogs.push(this.formatError(`${group.name || group.externalId}`, e))
      }
    }

    this.importResult.set(result)
    this.importing.set(false)
    await this.loadGroups()
  }

  /** Bereinigt Daten: null entfernen, SQLite-Booleans korrigieren */
  private sanitize(obj: any): any {
    if (Array.isArray(obj)) return obj.map(item => this.sanitize(item))
    if (obj && typeof obj === 'object') {
      const cleaned: any = {}
      for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) continue
        if (GroupListComponent.BOOLEAN_FIELDS.has(key)) {
          cleaned[key] = !!value
        } else {
          cleaned[key] = this.sanitize(value)
        }
      }
      return cleaned
    }
    return obj
  }

  private formatError(name: string, e: any): string {
    const msg = e?.error?.message || e?.message || 'Unbekannter Fehler'
    const details = e?.error?.data
    if (Array.isArray(details) && details.length > 0) {
      const fields = details.map((d: any) => `${d.instancePath || '?'}: ${d.message}`).join(', ')
      return `"${name}": ${msg} (${fields})`
    }
    return `"${name}": ${msg}`
  }
}
