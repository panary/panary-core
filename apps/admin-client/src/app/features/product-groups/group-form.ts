import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, signal, OnInit, input, output, effect, viewChild } from '@angular/core'
import { FormsModule, NgForm } from '@angular/forms'
import { Router } from '@angular/router'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'
import { objectHash } from '../../core/dirty-check'

@Component({
  selector: 'app-group-form',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="panelMode() ? 'p-5 space-y-5' : 'p-8 max-w-2xl space-y-6'">
      <h1 class="text-2xl font-bold tracking-tight">{{ isNew() ? 'Neue Produktgruppe' : 'Produktgruppe bearbeiten' }}</h1>

      <form #f="ngForm" (ngSubmit)="onSave(f)" class="space-y-5">
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

        <div class="grid grid-cols-3 gap-4">
          <!-- Name -->
          <div class="col-span-2 space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Name *</label>
            <input [(ngModel)]="form.name" name="name" #name="ngModel"
              type="text" required minlength="1" maxlength="120"
              (ngModelChange)="autoAssignColor($event)"
              [class]="inputClass(name)" />
            @if (name.invalid && name.touched) {
              <p class="text-red-400 text-xs mt-1">Name ist erforderlich.</p>
            }
          </div>
          <!-- Kürzel -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Kürzel</label>
            <input [(ngModel)]="form.acronym" name="acronym" type="text" maxlength="10"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                     focus:border-white focus:ring-1 focus:ring-white outline-none font-mono" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <!-- Farbe -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Farbe</label>
            <div class="relative">
              <div class="flex items-center gap-3 p-3 bg-gray-900 border border-gray-800 rounded-lg">
                <span class="w-8 h-8 rounded-full shrink-0 border border-gray-700"
                      [style.background-color]="form.color"></span>
                <span class="text-sm text-gray-300 font-mono">{{ form.color }}</span>
                <button type="button" (click)="showColorPicker = !showColorPicker"
                  class="ml-auto text-gray-500 hover:text-white transition text-xs">
                  {{ showColorPicker ? '▲' : '▼' }}
                </button>
              </div>
              @if (showColorPicker) {
                <div class="absolute z-10 mt-1 p-3 bg-gray-900 border border-gray-700 rounded-lg shadow-xl
                            flex flex-wrap gap-2 w-full">
                  @for (c of colorPalette; track c) {
                    <button type="button" (click)="form.color = c; showColorPicker = false"
                      [class]="form.color === c
                        ? 'w-7 h-7 rounded-full ring-2 ring-white ring-offset-1 ring-offset-gray-900 scale-110'
                        : 'w-7 h-7 rounded-full hover:scale-110 hover:ring-1 hover:ring-gray-500'"
                      [style.background-color]="c"
                      class="transition-all">
                    </button>
                  }
                </div>
              }
            </div>
            <input [(ngModel)]="form.color" name="color" type="hidden" />
          </div>
          <!-- Reihenfolge -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Reihenfolge *</label>
            <input [(ngModel)]="form.index" name="index" #indexCtrl="ngModel"
              type="number" required min="0" step="1"
              [class]="inputClass(indexCtrl)" />
            @if (indexCtrl.invalid && indexCtrl.touched) {
              <p class="text-red-400 text-xs mt-1">Reihenfolge ist erforderlich (0 = erste Position).</p>
            }
          </div>
        </div>

        <!-- MwSt. -->
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">MwSt. Inhaus (%)</label>
            <input [(ngModel)]="form.taxInside" name="taxInside" type="number" step="0.1" min="0" max="100"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                     focus:border-white focus:ring-1 focus:ring-white outline-none font-mono" />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">MwSt. Außer Haus (%)</label>
            <input [(ngModel)]="form.taxOutside" name="taxOutside" type="number" step="0.1" min="0" max="100"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                     focus:border-white focus:ring-1 focus:ring-white outline-none font-mono" />
          </div>
        </div>

        <!-- Sichtbarkeit -->
        <div class="flex items-center gap-6 pt-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <input [(ngModel)]="form.excluded" name="excluded" type="checkbox"
              class="w-4 h-4 accent-white" />
            <span class="text-sm text-gray-300">Im Bestelldialog ausblenden</span>
          </label>
        </div>

        <!-- Fehleranzeige -->
        @if (errors().length > 0) {
          <div class="bg-red-950/50 border border-red-900/50 rounded-lg p-4 space-y-1">
            @for (err of errors(); track err) {
              <p class="text-red-400 text-sm flex items-start gap-2">
                <span class="shrink-0 mt-0.5">&#x2715;</span>
                <span>{{ err }}</span>
              </p>
            }
          </div>
        }

        <div class="flex gap-3 pt-4">
          <button type="submit" [disabled]="saving() || savedSuccess() || f.invalid"
            [class]="'save-btn ' + (savedSuccess() ? 'save-btn--success' : saving() ? 'save-btn--saving' : 'save-btn--default')"
            [class.opacity-50]="f.invalid && !saving() && !savedSuccess()"
            [class.cursor-not-allowed]="f.invalid">
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
          <button type="button" (click)="onCancel()"
            class="bg-gray-900 border border-gray-800 text-gray-300 px-6 py-3 rounded-xl text-sm hover:bg-gray-800 transition">
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  `,
})
export class GroupFormComponent implements OnInit {
  private api = inject(ApiService)
  private router = inject(Router)
  private cdr = inject(ChangeDetectorRef)

  id = input<string>()
  panelMode = input(false)
  saved = output<void>()
  closed = output<void>()

  isNew = signal(true)
  saving = signal(false)

  // 24 kräftige, gut unterscheidbare Farben für Produktgruppen
  readonly colorPalette = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
    '#f43f5e', '#78716c', '#64748b', '#dc2626',
    '#059669', '#2563eb', '#7c3aed', '#db2777',
  ]

  // Farben die bereits von anderen Gruppen benutzt werden
  usedColors = signal<Set<string>>(new Set())
  showColorPicker = false
  savedSuccess = signal(false)

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
  errors = signal<string[]>([])
  private originalHash = ''

  isDirty(): boolean {
    if (this.isNew()) return !!this.form.name
    return objectHash(this.form) !== this.originalHash
  }

  async saveAndContinue(): Promise<boolean> {
    const f = this.formRef()
    if (f) await this.onSave(f)
    return this.errors().length === 0
  }

  discardChanges(): void {
    this.originalHash = objectHash(this.form)
  }
  entityId = signal<string>('')
  externalId = signal<string | null>(null)
  private formRef = viewChild<NgForm>('f')

  form = {
    name: '',
    acronym: '',
    color: '#6366f1',
    index: 0,
    taxInside: 19,
    taxOutside: 7,
    excluded: false,
    status: 'ACTIVE',
  }

  private readonly baseInputClass =
    'w-full bg-gray-900 border rounded-lg p-3 text-white focus:ring-1 outline-none'

  inputClass(ctrl: any): string {
    if (!ctrl || ctrl.pristine) return `${this.baseInputClass} border-gray-800 focus:border-white focus:ring-white`
    if (ctrl.invalid) return `${this.baseInputClass} border-red-500/50 focus:border-red-400 focus:ring-red-400`
    return `${this.baseInputClass} border-green-500/30 focus:border-green-400 focus:ring-green-400`
  }

  constructor() {
    effect(() => {
      const groupId = this.id()
      this.loadGroup(groupId)
    })
  }

  async ngOnInit() {
    await this.loadUsedColors()
  }

  /** Lädt alle Farben, die bereits von bestehenden Gruppen verwendet werden */
  private async loadUsedColors() {
    try {
      const result = await this.api.find<any>('product-groups', { $limit: 100 })
      const colors = new Set(result.data.map((g: any) => g.color?.toLowerCase()).filter(Boolean))
      this.usedColors.set(colors)
    } catch { /* Ignorieren */ }
  }

  /** Prüft ob eine Farbe bereits von einer anderen Gruppe verwendet wird */
  isColorUsed(color: string): boolean {
    if (!color) return false
    const used = this.usedColors()
    // Eigene Gruppe ausschließen
    return used.has(color.toLowerCase()) && this.form.color?.toLowerCase() !== color.toLowerCase()
  }

  /** Generiert eine Farbe aus dem Namen (deterministisch), die nicht vergeben ist */
  autoAssignColor(name: string): void {
    if (!name) return

    // Hash aus dem Namen berechnen → Index in die Palette
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
    }
    const startIdx = Math.abs(hash) % this.colorPalette.length

    // Erste nicht vergebene Farbe ab dem Hash-Index
    for (let offset = 0; offset < this.colorPalette.length; offset++) {
      const candidate = this.colorPalette[(startIdx + offset) % this.colorPalette.length]
      if (!this.isColorUsed(candidate)) {
        this.form.color = candidate
        return
      }
    }
    // Alle vergeben → nehme die Hash-Farbe trotzdem
    this.form.color = this.colorPalette[startIdx]
  }

  private async loadGroup(groupId: string | undefined) {
    this.formRef()?.resetForm()
    this.errors.set([])
    this.form = {
      name: '', acronym: '', color: '#6366f1', index: 0,
      taxInside: 19, taxOutside: 7, excluded: false, status: 'DRAFT',
    }
    this.entityId.set('')
    this.externalId.set(null)

    if (!groupId || groupId === 'new') {
      this.isNew.set(true)
      // Erste freie Farbe als Default
      const firstFree = this.colorPalette.find(c => !this.usedColors().has(c.toLowerCase()))
      this.form.color = firstFree || this.colorPalette[0]
      return
    }

    this.isNew.set(false)
    try {
      const group = await this.api.get<any>('product-groups', groupId)
      this.entityId.set(group._id || '')
      this.externalId.set(group.externalId || null)
      this.form = {
        name: group.name || '',
        acronym: group.acronym || '',
        color: group.color || '#6366f1',
        index: group.index ?? 0,
        taxInside: group.taxInside ?? 19,
        taxOutside: group.taxOutside ?? 7,
        excluded: group.excluded ?? false,
        status: group.status || 'ACTIVE',
      }
      this.originalHash = objectHash(this.form)
    } catch {
      this.errors.set(['Produktgruppe nicht gefunden.'])
    }
    this.cdr.markForCheck()
  }

  async onSave(f: NgForm) {
    if (f.invalid) {
      Object.values(f.controls).forEach(c => c.markAsTouched())
      return
    }

    this.saving.set(true)
    this.errors.set([])

    try {
      const data: any = { ...this.form }
      data.excluded = !!data.excluded
      if (!data.acronym) delete data.acronym

      if (this.isNew()) {
        await this.api.create('product-groups', data)
      } else {
        await this.api.patch('product-groups', this.id()!, data)
      }
      this.originalHash = objectHash(this.form)
      this.savedSuccess.set(true)
      this.cdr.markForCheck()
      // Tabelle sofort aktualisieren
      if (this.panelMode()) this.saved.emit()
      // Animation nach 2s zurücksetzen
      setTimeout(() => {
        this.savedSuccess.set(false)
        this.cdr.markForCheck()
        if (!this.panelMode()) this.router.navigate(['/product-groups'])
      }, 2000)
    } catch (e: any) {
      const msg = formatApiError(e)
      this.errors.set(msg.split('\n'))
    }
    this.saving.set(false)
  }

  onCancel() {
    this.panelMode() ? this.closed.emit() : this.router.navigate(['/product-groups'])
  }
}
