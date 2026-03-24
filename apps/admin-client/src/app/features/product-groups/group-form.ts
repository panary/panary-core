import { ChangeDetectionStrategy, Component, inject, signal, OnInit, input } from '@angular/core'
import { FormsModule, NgForm } from '@angular/forms'
import { Router } from '@angular/router'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'

@Component({
  selector: 'app-group-form',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-8 max-w-2xl space-y-6">
      <h1 class="text-2xl font-bold tracking-tight">{{ isNew() ? 'Neue Produktgruppe' : 'Produktgruppe bearbeiten' }}</h1>

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

      <form #f="ngForm" (ngSubmit)="onSave(f)" class="space-y-5">
        <div class="grid grid-cols-3 gap-4">
          <!-- Name -->
          <div class="col-span-2 space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Name *</label>
            <input [(ngModel)]="form.name" name="name" #name="ngModel"
              type="text" required minlength="1" maxlength="120"
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
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Farbe *</label>
            <div class="flex items-center gap-3">
              <input [(ngModel)]="form.color" name="colorPicker" type="color"
                class="w-10 h-10 rounded-lg border border-gray-800 bg-gray-900 cursor-pointer p-1" />
              <input [(ngModel)]="form.color" name="color" #colorText="ngModel"
                type="text" required pattern="^#[0-9a-fA-F]{6}$"
                placeholder="#6366f1"
                class="flex-1 bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                       focus:border-white focus:ring-1 focus:ring-white outline-none font-mono" />
            </div>
            @if (colorText.invalid && colorText.touched) {
              <p class="text-red-400 text-xs mt-1">Gültiger Hex-Farbwert erforderlich (z.B. #6366f1).</p>
            }
          </div>
          <!-- Sortierung -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Sortierung *</label>
            <input [(ngModel)]="form.index" name="index" #indexCtrl="ngModel"
              type="number" required min="0" step="1"
              [class]="inputClass(indexCtrl)" />
            @if (indexCtrl.invalid && indexCtrl.touched) {
              <p class="text-red-400 text-xs mt-1">Sortierindex ist erforderlich.</p>
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

        <!-- Status -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Status</label>
          <select [(ngModel)]="form.status" name="status"
            class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white outline-none">
            <option value="DRAFT">Entwurf</option>
            <option value="ACTIVE">Aktiv</option>
            <option value="ARCHIVED">Archiviert</option>
          </select>
        </div>

        <!-- Ausgeschlossen -->
        <div class="flex items-center gap-6 pt-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <input [(ngModel)]="form.excluded" name="excluded" type="checkbox"
              class="w-4 h-4 accent-white" />
            <span class="text-sm text-gray-300">Von Berichten ausschließen</span>
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
          <button type="submit" [disabled]="saving() || f.invalid"
            class="bg-white text-black font-bold px-8 py-3 rounded-xl text-sm hover:bg-gray-200 transition
                   disabled:opacity-50 disabled:cursor-not-allowed">
            {{ saving() ? 'Speichern...' : 'Speichern' }}
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

  id = input<string>()
  isNew = signal(true)
  saving = signal(false)
  errors = signal<string[]>([])
  entityId = signal<string>('')
  externalId = signal<string | null>(null)

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

  async ngOnInit() {
    const groupId = this.id()
    if (groupId && groupId !== 'new') {
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
      } catch {
        this.errors.set(['Produktgruppe nicht gefunden.'])
      }
    }
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
      if (!data.acronym) delete data.acronym

      if (this.isNew()) {
        await this.api.create('product-groups', data)
      } else {
        await this.api.patch('product-groups', this.id()!, data)
      }
      this.router.navigate(['/product-groups'])
    } catch (e: any) {
      const msg = formatApiError(e)
      this.errors.set(msg.split('\n'))
    }
    this.saving.set(false)
  }

  onCancel() {
    this.router.navigate(['/product-groups'])
  }
}
