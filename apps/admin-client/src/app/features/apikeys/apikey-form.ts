import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, signal, input, output, effect, viewChild } from '@angular/core'
import { FormsModule, NgForm } from '@angular/forms'
import { Router } from '@angular/router'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'

interface ApikeyDetail {
  _id: string
  name: string
  description?: string
  role: string
  validUntil?: string
  active: boolean
  createdAt?: string
  createdBy?: string
  lastUsedAt?: string
  deviceId?: string
}

@Component({
  selector: 'app-apikey-form',
  standalone: true,
  imports: [FormsModule, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="panelMode() ? 'p-5 space-y-5' : 'p-8 max-w-2xl space-y-6'">
      <!-- ========================================== -->
      <!-- CREATE: Formular für neuen API-Schlüssel   -->
      <!-- ========================================== -->
      @if (isNew()) {
        <h1 class="text-2xl font-bold tracking-tight">Neuer API-Schlüssel</h1>

        <form #f="ngForm" (ngSubmit)="onCreate(f)" class="space-y-5">
          <div class="space-y-1">
            <label for="apikeyName" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Name *</label>
            <input id="apikeyName" [(ngModel)]="form.name" name="name" #name="ngModel"
              type="text" required minlength="2" maxlength="80"
              placeholder="z.B. POS Kasse 1"
              [class]="inputClass(name)" />
            @if (name.invalid && name.touched) {
              <p class="text-red-500 dark:text-red-400 text-xs mt-1">
                @if (name.errors?.['required']) { Name ist erforderlich. }
                @else if (name.errors?.['minlength']) { Mindestens 2 Zeichen. }
              </p>
            }
          </div>

          <div class="space-y-1">
            <label for="apikeyDescription" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Beschreibung</label>
            <textarea id="apikeyDescription" [(ngModel)]="form.description" name="description"
              rows="2" placeholder="Optionale Beschreibung des Verwendungszwecks"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none resize-none
                     placeholder-slate-400 dark:placeholder-gray-600"></textarea>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <label for="apikeyRole" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Rolle *</label>
              <select id="apikeyRole" [(ngModel)]="form.role" name="role"
                class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                       text-slate-900 dark:text-white outline-none">
                <option value="device:pos">POS-Kasse</option>
                <option value="device:kds">Küchen-Display</option>
                <option value="device:tablet">Tablet</option>
                <option value="device:kiosk">Kiosk</option>
              </select>
            </div>
            <div class="space-y-1">
              <label for="apikeyValidUntil" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Gültig bis</label>
              <input id="apikeyValidUntil" [(ngModel)]="form.validUntil" name="validUntil" type="date"
                class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                       text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                       focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
            </div>
          </div>

          @if (errors().length > 0) {
            <div class="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded-lg p-4 space-y-1">
              @for (err of errors(); track err) {
                <p class="text-red-500 dark:text-red-400 text-sm flex items-start gap-2">
                  <span class="shrink-0 mt-0.5">✕</span>
                  <span>{{ err }}</span>
                </p>
              }
            </div>
          }

          <div class="flex gap-3 pt-4">
            <button type="submit" [disabled]="saving() || f.invalid"
              class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-6 py-3 rounded-xl text-sm
                     hover:bg-slate-800 dark:hover:bg-gray-200 transition
                     disabled:opacity-50 disabled:cursor-not-allowed">
              @if (saving()) {
                <span class="save-spinner"></span>
              } @else {
                Erstellen
              }
            </button>
            <button type="button" (click)="onCancel()"
              class="bg-slate-100 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-slate-600
                     dark:text-gray-300 px-6 py-3 rounded-xl text-sm hover:bg-slate-200 dark:hover:bg-gray-800 transition">
              Abbrechen
            </button>
          </div>
        </form>
      } @else {
        <!-- ========================================== -->
        <!-- DETAIL: Nur-Lese-Ansicht + Aktionen        -->
        <!-- ========================================== -->
        <h1 class="text-2xl font-bold tracking-tight">API-Schlüssel</h1>

        @if (detail()) {
          <!-- Status-Banner -->
          <div class="flex items-center gap-3 rounded-xl p-3"
               [class]="detail()!.active
                 ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/50'
                 : 'bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800'">
            <div class="w-2.5 h-2.5 rounded-full"
                 [class]="detail()!.active ? 'bg-green-400' : 'bg-slate-300 dark:bg-gray-600'"></div>
            <span class="text-sm font-medium"
                  [class]="detail()!.active
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-slate-500 dark:text-gray-400'">
              {{ detail()!.active ? 'Aktiv' : 'Deaktiviert' }}
            </span>
          </div>

          <!-- Detail-Tabelle -->
          <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800
                      rounded-xl divide-y divide-slate-200 dark:divide-gray-800">
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">Name</span>
              <span class="text-sm text-slate-900 dark:text-white font-medium">{{ detail()!.name }}</span>
            </div>
            @if (detail()!.description) {
              <div class="flex items-center justify-between px-4 py-3">
                <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">Beschreibung</span>
                <span class="text-sm text-slate-900 dark:text-white">{{ detail()!.description }}</span>
              </div>
            }
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">Rolle</span>
              <span class="text-xs px-2 py-0.5 rounded-full border border-slate-300 dark:border-gray-700
                           text-slate-600 dark:text-gray-300">
                {{ formatRole(detail()!.role) }}
              </span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">Gültig bis</span>
              <span class="text-sm text-slate-900 dark:text-white">
                {{ detail()!.validUntil ? formatDate(detail()!.validUntil!) : 'Unbegrenzt' }}
              </span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">Erstellt am</span>
              <span class="text-sm text-slate-900 dark:text-white">{{ formatDate(detail()!.createdAt!) }}</span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">Erstellt von</span>
              <span class="text-sm text-slate-900 dark:text-white">{{ detail()!.createdBy || '—' }}</span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">Letzte Nutzung</span>
              <span class="text-sm text-slate-900 dark:text-white">
                {{ detail()!.lastUsedAt ? formatDate(detail()!.lastUsedAt!) : 'Nie verwendet' }}
              </span>
            </div>
            @if (detail()!.deviceId) {
              <div class="flex items-center justify-between px-4 py-3">
                <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">Geräte-ID</span>
                <span class="text-sm text-slate-500 dark:text-gray-400 font-mono text-xs">{{ detail()!.deviceId }}</span>
              </div>
            }
          </div>

          @if (errors().length > 0) {
            <div class="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded-lg p-4 space-y-1">
              @for (err of errors(); track err) {
                <p class="text-red-500 dark:text-red-400 text-sm flex items-start gap-2">
                  <span class="shrink-0 mt-0.5">✕</span>
                  <span>{{ err }}</span>
                </p>
              }
            </div>
          }

          <!-- Aktionen -->
          <div class="flex gap-3 pt-2">
            <button (click)="onToggleActive()" [disabled]="saving()"
              [class]="detail()!.active
                ? 'bg-slate-100 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-slate-600 dark:text-gray-300 px-6 py-3 rounded-xl text-sm hover:bg-slate-200 dark:hover:bg-gray-800 transition disabled:opacity-50'
                : 'bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-6 py-3 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition disabled:opacity-50'">
              {{ detail()!.active ? 'Deaktivieren' : 'Aktivieren' }}
            </button>
            <button (click)="confirmingDelete.set(true)"
              class="text-red-500 dark:text-red-400 text-sm hover:text-red-700 dark:hover:text-red-300 transition px-4 py-3">
              Löschen
            </button>
            <div class="flex-1"></div>
            <button (click)="onCancel()"
              class="text-slate-400 dark:text-gray-500 text-sm hover:text-slate-900 dark:hover:text-white transition px-4 py-3">
              Schließen
            </button>
          </div>
        }
      }
    </div>

    @if (confirmingDelete()) {
      <app-confirm-dialog
        title="API-Schlüssel löschen"
        message="Sind Sie sicher? Geräte, die diesen Schlüssel verwenden, verlieren den Zugriff. Diese Aktion kann nicht rückgängig gemacht werden."
        confirmLabel="Endgültig löschen"
        dismissLabel="Abbrechen"
        (confirmed)="onDelete()"
        (dismissed)="confirmingDelete.set(false)"
        (cancelled)="confirmingDelete.set(false)" />
    }
  `,
})
export class ApikeyFormComponent {
  private api = inject(ApiService)
  private router = inject(Router)
  private cdr = inject(ChangeDetectorRef)

  id = input<string>()
  panelMode = input(false)
  saved = output<void>()
  created = output<any>()
  closed = output<void>()

  isNew = signal(true)
  saving = signal(false)
  errors = signal<string[]>([])
  confirmingDelete = signal(false)
  detail = signal<ApikeyDetail | null>(null)
  private formRef = viewChild<NgForm>('f')

  form = {
    name: '',
    description: '',
    role: 'device:pos',
    validUntil: '',
  }

  // Im Edit-Modus gibt es kein Dirty — nur Create hat ein Formular
  isDirty(): boolean {
    if (this.isNew()) return !!this.form.name
    return false
  }

  async saveAndContinue(): Promise<boolean> {
    const f = this.formRef()
    if (f && this.isNew()) await this.onCreate(f)
    return this.errors().length === 0
  }

  discardChanges(): void {
    // Kein Dirty-State im Detail-Modus — nur für Create relevant
  }

  formatRole(role: string): string {
    const map: Record<string, string> = {
      'device:pos': 'POS-Kasse',
      'device:kds': 'Küchen-Display',
      'device:tablet': 'Tablet',
      'device:kiosk': 'Kiosk',
    }
    return map[role] || role
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    } catch {
      return iso
    }
  }

  private readonly baseInputClass =
    'w-full bg-white dark:bg-gray-900 border rounded-lg p-3 text-slate-900 dark:text-white focus:ring-1 outline-none'

  inputClass(ctrl: any): string {
    if (!ctrl || ctrl.pristine)
      return `${this.baseInputClass} border-slate-200 dark:border-gray-800 focus:border-slate-900 dark:focus:border-white focus:ring-slate-900 dark:focus:ring-white`
    if (ctrl.invalid) return `${this.baseInputClass} border-red-500/50 focus:border-red-400 focus:ring-red-400`
    return `${this.baseInputClass} border-green-500/30 focus:border-green-400 focus:ring-green-400`
  }

  constructor() {
    effect(() => {
      const keyId = this.id()
      this.loadApikey(keyId)
    })
  }

  private async loadApikey(keyId: string | undefined) {
    this.formRef()?.resetForm()
    this.errors.set([])
    this.confirmingDelete.set(false)
    this.detail.set(null)
    this.form = { name: '', description: '', role: 'device:pos', validUntil: '' }

    if (!keyId || keyId === 'new') {
      this.isNew.set(true)
      return
    }

    this.isNew.set(false)
    try {
      const key = await this.api.get<ApikeyDetail>('apikeys', keyId)
      this.detail.set(key)
    } catch {
      this.errors.set(['API-Schlüssel nicht gefunden.'])
    }
    this.cdr.markForCheck()
  }

  async onCreate(f: NgForm) {
    if (f.invalid) {
      Object.values(f.controls).forEach(c => c.markAsTouched())
      return
    }

    this.saving.set(true)
    this.errors.set([])

    try {
      const data: Record<string, unknown> = {
        name: this.form.name,
        description: this.form.description || undefined,
        role: this.form.role,
      }
      if (this.form.validUntil) {
        data['validUntil'] = new Date(this.form.validUntil).toISOString()
      }

      const result = await this.api.create<any>('apikeys', data)
      this.created.emit(result)
    } catch (e: any) {
      const msg = formatApiError(e)
      this.errors.set(msg.split('\n'))
    }
    this.saving.set(false)
  }

  async onToggleActive() {
    const current = this.detail()
    if (!current) return

    this.saving.set(true)
    this.errors.set([])

    try {
      await this.api.patch('apikeys', current._id, { active: !current.active })
      this.detail.set({ ...current, active: !current.active })
      this.saved.emit()
    } catch (e: any) {
      const msg = formatApiError(e)
      this.errors.set(msg.split('\n'))
    }
    this.saving.set(false)
    this.cdr.markForCheck()
  }

  async onDelete() {
    this.confirmingDelete.set(false)
    try {
      await this.api.remove('apikeys', this.id()!)
      if (this.panelMode()) {
        this.saved.emit()
      } else {
        this.router.navigate(['/apikeys'])
      }
    } catch (e: any) {
      const msg = formatApiError(e)
      this.errors.set(msg.split('\n'))
    }
  }

  onCancel() {
    if (this.panelMode()) {
      this.closed.emit()
    } else {
      this.router.navigate(['/apikeys'])
    }
  }
}
