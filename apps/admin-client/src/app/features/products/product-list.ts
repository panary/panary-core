import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit, viewChild } from '@angular/core'
import { ApiService } from '../../core/api.service'
import { ProductFormComponent } from './product-form'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [ProductFormComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full">
      <!-- Linke Seite: Tabelle -->
      <div [class]="selectedId() ? 'w-72 shrink-0 border-r border-gray-800' : 'flex-1'"
           class="overflow-y-auto transition-all">
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between">
            <h1 class="text-xl font-bold tracking-tight">Produkte</h1>
            <button (click)="selectItem('new')"
              class="bg-white text-black font-bold px-4 py-2 rounded-xl text-xs hover:bg-gray-200 transition">
              + Neu
            </button>
          </div>

          @if (products().length === 0 && !loading()) {
            <p class="text-gray-500 text-center py-12 text-sm">Keine Produkte</p>
          } @else {
            <div class="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-gray-800 text-left text-gray-500 text-xs uppercase tracking-wider">
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
                  @for (p of products(); track p._id) {
                    <tr (click)="selectItem(p._id)"
                        [class]="p._id === selectedId()
                          ? 'bg-white/5 border-l-2 border-l-white'
                          : 'hover:bg-gray-800/30 border-l-2 border-l-transparent'"
                        class="cursor-pointer border-b border-gray-800/50 transition">
                      <td class="px-3 py-2.5 font-medium truncate max-w-48">{{ p.name }}</td>
                      @if (!selectedId()) {
                        <td class="px-3 py-2.5 text-gray-400 font-mono text-xs">{{ p.acronym }}</td>
                        <td class="px-3 py-2.5 font-mono text-xs">{{ (p.price || 0).toFixed(2) }} &euro;</td>
                        <td class="px-3 py-2.5">
                          <span class="text-xs px-2 py-0.5 rounded-full border border-gray-700 text-gray-300">
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
          <div class="shrink-0 bg-gray-950 border-b border-gray-800 px-4 py-2.5 flex items-center gap-2">
            <button (click)="prevItem()" [disabled]="currentIndex() <= 0"
              class="text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed
                     w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition text-sm">
              ◀
            </button>
            <span class="text-xs text-gray-500 min-w-12 text-center">
              @if (selectedId() !== 'new') {
                {{ currentIndex() + 1 }} / {{ products().length }}
              } @else {
                Neu
              }
            </span>
            <button (click)="nextItem()" [disabled]="currentIndex() >= products().length - 1"
              class="text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed
                     w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition text-sm">
              ▶
            </button>
            <div class="flex-1"></div>
            <button (click)="selectedId.set(null)"
              class="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center
                     rounded-lg hover:bg-gray-800 transition text-sm">
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
    </div>
  `,
})
export class ProductListComponent implements OnInit {
  private api = inject(ApiService)
  products = signal<any[]>([])
  loading = signal(true)
  selectedId = signal<string | null>(null)

  private formRef = viewChild<ProductFormComponent>('formRef')
  pendingNavAction: (() => void) | null = null

  currentIndex = computed(() => {
    const id = this.selectedId()
    if (!id || id === 'new') return -1
    return this.products().findIndex(p => p._id === id)
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

  /** Navigiert nur wenn keine ungespeicherten Änderungen, sonst Dialog */
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
    if (idx > 0) this.navigateWithDirtyCheck(() => this.selectedId.set(this.products()[idx - 1]._id))
  }

  nextItem() {
    const idx = this.currentIndex()
    if (idx < this.products().length - 1) this.navigateWithDirtyCheck(() => this.selectedId.set(this.products()[idx + 1]._id))
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

  async ngOnInit() {
    await this.loadProducts()
  }

  private async loadProducts() {
    try {
      const result = await this.api.find<any>('products', { $limit: 200 })
      this.products.set(result.data)
    } catch (e) {
      console.error('Fehler beim Laden der Produkte:', e)
    }
    this.loading.set(false)
  }
}
