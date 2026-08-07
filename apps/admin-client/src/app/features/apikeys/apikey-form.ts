import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  signal,
  input,
  output,
  effect,
  untracked,
  viewChild,
} from '@angular/core'
import { FormsModule, NgForm } from '@angular/forms'
import { Router } from '@angular/router'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
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

interface DeviceRef {
  _id: string
  deviceId: string
  name: string
  active: boolean
}

/**
 * Ergebnis des Geraete-Lookups — bewusst dreiwertig statt `DeviceRef | null`.
 *
 * TENANT_MANAGER hat in der RBAC-Matrix keinen DEVICES-Eintrag (nur
 * APIKEYS: READ), `find('devices')` liefert ihm also 403. Wuerde ein 403 als
 * „verwaist" gelesen, bekaeme jeder Manager bei JEDEM Schluessel den
 * Loeschen-Dialog. `unknown` trennt „nachweislich kein Geraet" von
 * „keine Auskunft".
 */
type DeviceLookup =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'found'; device: DeviceRef }
  | { state: 'orphan'; deviceId: string }
  | { state: 'unknown'; deviceId: string }

@Component({
  selector: 'app-apikey-form',
  standalone: true,
  imports: [FormsModule, ConfirmDialogComponent, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="panelMode() ? 'p-5 max-w-2xl mx-auto space-y-5' : 'p-8 max-w-2xl space-y-6'">
      <!-- ========================================== -->
      <!-- CREATE: Formular für neuen API-Schlüssel   -->
      <!-- ========================================== -->
      @if (isNew()) {
        <h1 class="text-2xl font-bold tracking-tight">{{ 'APIKEYS.NEW_KEY' | translate }}</h1>

        <form #f="ngForm" (ngSubmit)="onCreate(f)" class="space-y-5">
          <div class="space-y-1">
            <label
              for="apikeyName"
              class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider"
              >{{ 'COMMON.NAME' | translate }} *</label
            >
            <input
              id="apikeyName"
              [(ngModel)]="form.name"
              name="name"
              #name="ngModel"
              type="text"
              required
              minlength="2"
              maxlength="80"
              placeholder="z.B. POS Kasse 1"
              [class]="inputClass(name)"
            />
            @if (name.invalid && name.touched) {
              <p class="text-red-500 dark:text-red-400 text-xs mt-1">
                @if (name.errors?.['required']) {
                  {{ 'APIKEYS.NAME_REQUIRED' | translate }}
                } @else if (name.errors?.['minlength']) {
                  {{ 'COMMON.MIN_CHARS' | translate: { count: 2 } }}
                }
              </p>
            }
          </div>

          <div class="space-y-1">
            <label
              for="apikeyDescription"
              class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider"
              >{{ 'APIKEYS.DESCRIPTION' | translate }}</label
            >
            <textarea
              id="apikeyDescription"
              [(ngModel)]="form.description"
              name="description"
              rows="2"
              placeholder="Optionale Beschreibung des Verwendungszwecks"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none resize-none
                     placeholder-slate-400 dark:placeholder-gray-600"
            ></textarea>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <label
                for="apikeyRole"
                class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider"
                >{{ 'USERS.ROLE' | translate }} *</label
              >
              <select
                id="apikeyRole"
                [(ngModel)]="form.role"
                name="role"
                class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                       text-slate-900 dark:text-white outline-none"
              >
                <option value="device:pos-client">{{ 'ROLES.DEVICE_POS' | translate }}</option>
                <option value="device:kds">{{ 'ROLES.DEVICE_KDS' | translate }}</option>
                <option value="device:tablet">{{ 'ROLES.DEVICE_TABLET' | translate }}</option>
                <option value="device:kiosk">{{ 'ROLES.DEVICE_KIOSK' | translate }}</option>
              </select>
            </div>
            <div class="space-y-1">
              <label
                for="apikeyValidUntil"
                class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider"
                >{{ 'APIKEYS.VALID_UNTIL' | translate }}</label
              >
              <input
                id="apikeyValidUntil"
                [(ngModel)]="form.validUntil"
                name="validUntil"
                type="date"
                class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                       text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                       focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none"
              />
            </div>
          </div>

          @if (errors().length > 0) {
            <div
              class="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded-lg p-4 space-y-1"
            >
              @for (err of errors(); track err) {
                <p class="text-red-500 dark:text-red-400 text-sm flex items-start gap-2">
                  <span class="shrink-0 mt-0.5">✕</span>
                  <span>{{ err }}</span>
                </p>
              }
            </div>
          }

          <div class="flex gap-3 pt-4">
            <button
              type="submit"
              [disabled]="saving() || f.invalid"
              class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-6 py-3 rounded-xl text-sm
                     hover:bg-slate-800 dark:hover:bg-gray-200 transition
                     disabled:opacity-50 disabled:cursor-not-allowed"
            >
              @if (saving()) {
                <span class="save-spinner"></span>
              } @else {
                {{ 'COMMON.CREATE' | translate }}
              }
            </button>
            <button
              type="button"
              (click)="onCancel()"
              class="bg-slate-100 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-slate-600
                     dark:text-gray-300 px-6 py-3 rounded-xl text-sm hover:bg-slate-200 dark:hover:bg-gray-800 transition"
            >
              {{ 'COMMON.CANCEL' | translate }}
            </button>
          </div>
        </form>
      } @else {
        <!-- ========================================== -->
        <!-- DETAIL: Nur-Lese-Ansicht + Aktionen        -->
        <!-- ========================================== -->
        <!-- Titel = Name des Schluessels. Skeleton statt Textwechsel, damit beim
             Blaettern nicht kurz „API-Schluessel" aufblitzt und dann umspringt. -->
        @if (detail(); as key) {
          <h1 class="text-2xl font-bold tracking-tight truncate" [title]="key.name">{{ key.name }}</h1>
        } @else if (errors().length > 0) {
          <h1 class="text-2xl font-bold tracking-tight text-slate-400 dark:text-gray-600">
            {{ 'APIKEYS.TITLE' | translate }}
          </h1>
        } @else {
          <div class="h-8 w-48 rounded-lg bg-slate-100 dark:bg-gray-800 animate-pulse"></div>
        }

        @if (detail()) {
          <!-- Status-Banner -->
          <div
            class="flex items-center gap-3 rounded-xl p-3"
            [class]="
              detail()!.active
                ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/50'
                : 'bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800'
            "
          >
            <div
              class="w-2.5 h-2.5 rounded-full"
              [class]="detail()!.active ? 'bg-green-400' : 'bg-slate-300 dark:bg-gray-600'"
            ></div>
            <span
              class="text-sm font-medium"
              [class]="detail()!.active ? 'text-green-700 dark:text-green-400' : 'text-slate-500 dark:text-gray-400'"
            >
              {{ (detail()!.active ? 'COMMON.STATUS_ACTIVE' : 'APIKEYS.DEACTIVATED') | translate }}
            </span>
          </div>

          <!-- Detail-Tabelle -->
          <div
            class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800
                      rounded-xl divide-y divide-slate-200 dark:divide-gray-800"
          >
            @if (detail()!.description) {
              <div class="flex items-center justify-between px-4 py-3">
                <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">{{
                  'APIKEYS.DESCRIPTION' | translate
                }}</span>
                <span class="text-sm text-slate-900 dark:text-white">{{ detail()!.description }}</span>
              </div>
            }
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">{{
                'USERS.ROLE' | translate
              }}</span>
              <span
                class="text-xs px-2 py-0.5 rounded-full border border-slate-300 dark:border-gray-700
                           text-slate-600 dark:text-gray-300"
              >
                {{ formatRole(detail()!.role) }}
              </span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">{{
                'APIKEYS.VALID_UNTIL' | translate
              }}</span>
              <span class="text-sm text-slate-900 dark:text-white">
                {{ detail()!.validUntil ? formatDate(detail()!.validUntil!) : ('APIKEYS.UNLIMITED' | translate) }}
              </span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">{{
                'APIKEYS.CREATED_AT' | translate
              }}</span>
              <span class="text-sm text-slate-900 dark:text-white">{{ formatDate(detail()!.createdAt!) }}</span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">{{
                'APIKEYS.CREATED_BY' | translate
              }}</span>
              <span class="text-sm text-slate-900 dark:text-white">{{ detail()!.createdBy || '—' }}</span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider">{{
                'APIKEYS.LAST_USED' | translate
              }}</span>
              <span class="text-sm text-slate-900 dark:text-white">
                {{ detail()!.lastUsedAt ? formatDateTime(detail()!.lastUsedAt!) : ('APIKEYS.NEVER_USED' | translate) }}
              </span>
            </div>
            @if (detail()!.deviceId) {
              <div class="flex items-start justify-between gap-3 px-4 py-3">
                <span class="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wider shrink-0 mt-0.5">
                  {{ 'APIKEYS.DEVICE' | translate }}
                </span>
                <div class="text-right min-w-0">
                  @switch (deviceLookup().state) {
                    @case ('loading') {
                      <span class="text-sm text-slate-400 dark:text-gray-500">{{ 'COMMON.LOADING' | translate }}</span>
                    }
                    @case ('found') {
                      <span class="text-sm text-slate-900 dark:text-white font-medium block truncate">
                        {{ deviceLabel() }}
                      </span>
                    }
                    @case ('orphan') {
                      <span
                        class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full
                                   ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-600/20
                                   dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-500/30"
                        [title]="'APIKEYS.DEVICE_ORPHANED_HINT' | translate"
                      >
                        &#9888; {{ 'APIKEYS.DEVICE_ORPHANED' | translate }}
                      </span>
                    }
                    @case ('unknown') {
                      <span
                        class="text-sm text-slate-400 dark:text-gray-500"
                        [title]="'APIKEYS.DEVICE_UNKNOWN_HINT' | translate"
                        >&mdash;</span
                      >
                    }
                  }
                  <!-- Rohe ID bleibt sichtbar und markierbar — im Support-Fall
                       ist sie der Schluessel zum Log. -->
                  <span class="text-slate-400 dark:text-gray-600 font-mono text-[11px] block mt-0.5 select-all">
                    {{ detail()!.deviceId }}
                  </span>
                </div>
              </div>
            }
          </div>

          @if (errors().length > 0) {
            <div
              class="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded-lg p-4 space-y-1"
            >
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
            <button
              (click)="onToggleActive()"
              [disabled]="saving()"
              [class]="
                detail()!.active
                  ? 'bg-slate-100 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-slate-600 dark:text-gray-300 px-6 py-3 rounded-xl text-sm hover:bg-slate-200 dark:hover:bg-gray-800 transition disabled:opacity-50'
                  : 'bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-6 py-3 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition disabled:opacity-50'
              "
            >
              {{ (detail()!.active ? 'APIKEYS.DEACTIVATE' : 'APIKEYS.ACTIVATE') | translate }}
            </button>
            <button
              (click)="confirmingDelete.set(true)"
              class="text-red-500 dark:text-red-400 text-sm hover:text-red-700 dark:hover:text-red-300 transition px-4 py-3"
            >
              {{ 'COMMON.DELETE' | translate }}
            </button>
            <div class="flex-1"></div>
            <button
              (click)="onCancel()"
              class="text-slate-400 dark:text-gray-500 text-sm hover:text-slate-900 dark:hover:text-white transition px-4 py-3"
            >
              {{ 'COMMON.CLOSE' | translate }}
            </button>
          </div>
        }
      }
    </div>

    @if (confirmingDelete()) {
      <app-confirm-dialog
        [title]="'APIKEYS.DELETE_KEY' | translate"
        [message]="'APIKEYS.DELETE_CONFIRM' | translate"
        [warning]="deleteWarning()"
        [confirmLabel]="'APIKEYS.DELETE_PERMANENTLY' | translate"
        [dismissLabel]="'COMMON.CANCEL' | translate"
        (confirmed)="onDelete()"
        (dismissed)="confirmingDelete.set(false)"
        (cancelled)="confirmingDelete.set(false)"
      />
    }

    <!-- Verwaister Schluessel: einmal je Eintrag beim Oeffnen anbieten, nicht
         erneut beim Zurueckblaettern (siehe #orphanPrompted). -->
    @if (orphanPromptFor()) {
      <app-confirm-dialog
        [title]="'APIKEYS.ORPHAN_TITLE' | translate"
        [message]="'APIKEYS.ORPHAN_MESSAGE' | translate"
        [confirmLabel]="'APIKEYS.DELETE_PERMANENTLY' | translate"
        [dismissLabel]="'APIKEYS.ORPHAN_KEEP' | translate"
        (confirmed)="onDeleteOrphan()"
        (dismissed)="orphanPromptFor.set(null)"
        (cancelled)="orphanPromptFor.set(null)"
      />
    }
  `,
})
export class ApikeyFormComponent {
  private api = inject(ApiService)
  private router = inject(Router)
  private cdr = inject(ChangeDetectorRef)
  private t = inject(TranslateService)

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
  deviceLookup = signal<DeviceLookup>({ state: 'none' })
  /** Fuer welchen Schluessel der Verwaist-Dialog gerade offen ist. */
  orphanPromptFor = signal<string | null>(null)
  private formRef = viewChild<NgForm>('f')

  /**
   * Schluessel-IDs, fuer die der Verwaist-Dialog in dieser Sitzung schon offen war.
   * BEWUSST ein Plain-Set und kein Signal: es wird nie im Template gelesen, kann
   * also weder Change Detection ausloesen noch in einen Effect-Tracking-Scope
   * geraten. Verhindert, dass der Dialog beim Zurueckblaettern erneut aufpoppt.
   */
  readonly #orphanPrompted = new Set<string>()

  deviceLabel = computed(() => {
    const lookup = this.deviceLookup()
    return lookup.state === 'found' ? lookup.device.name : null
  })

  /**
   * Zusatzwarnung beim Loeschen — nur bei einem EXISTIERENDEN und AKTIVEN Geraet.
   * Bei `orphan` gibt es kein Geraet, bei `unknown` fehlt die Auskunft: beides
   * darf keine Warnung erfinden. Ein deaktiviertes Geraet verliert nichts.
   */
  deleteWarning = computed(() => {
    const lookup = this.deviceLookup()
    if (lookup.state !== 'found' || !lookup.device.active) return ''
    return this.t.instant('APIKEYS.DELETE_DEVICE_WARNING', { device: lookup.device.name })
  })

  form = {
    name: '',
    description: '',
    role: 'device:pos-client',
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
      'device:pos-client': 'ROLES.DEVICE_POS',
      'device:kds': 'ROLES.DEVICE_KDS',
      'device:tablet': 'ROLES.DEVICE_TABLET',
      'device:kiosk': 'ROLES.DEVICE_KIOSK',
    }
    return map[role] ? this.t.instant(map[role]) : role
  }

  // Locale einmal beim Konstruieren aufgeloest: ein Sprachwechsel baut die Route
  // nicht neu auf, wirkt hier also erst beim naechsten Oeffnen des Panels.
  private readonly dateFormatter = new Intl.DateTimeFormat(this.uiLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  private readonly dateTimeFormatter = new Intl.DateTimeFormat(this.uiLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  private uiLocale(): string {
    return this.t.currentLang || this.t.getDefaultLang() || 'de'
  }

  /** Tagesgenau — fuer „Gueltig bis" und „Erstellt am". */
  formatDate(iso: string): string {
    try {
      return this.dateFormatter.format(new Date(iso))
    } catch {
      return iso
    }
  }

  /** Minutengenau — fuer „Letzte Nutzung"; dort ist die Uhrzeit die Information. */
  formatDateTime(iso: string): string {
    try {
      return this.dateTimeFormatter.format(new Date(iso))
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
    // id() bewusst getrackt; loadApikey() setzt vor dem ersten await mehrere
    // Signals — ohne untracked() landen diese Writes im Tracking-Scope und
    // koennen den Effect erneut ausloesen (angular.md §2.1).
    effect(() => {
      const keyId = this.id()
      untracked(() => void this.loadApikey(keyId))
    })
  }

  private async loadApikey(keyId: string | undefined) {
    this.formRef()?.resetForm()
    this.errors.set([])
    this.confirmingDelete.set(false)
    this.detail.set(null)
    this.deviceLookup.set({ state: 'none' })
    this.orphanPromptFor.set(null)
    this.form = { name: '', description: '', role: 'device:pos-client', validUntil: '' }

    if (!keyId || keyId === 'new') {
      this.isNew.set(true)
      return
    }

    this.isNew.set(false)
    try {
      const key = await this.api.get<ApikeyDetail>('apikeys', keyId)
      this.detail.set(key)
      this.cdr.markForCheck()
      await this.resolveDevice(key)
    } catch {
      this.errors.set([this.t.instant('APIKEYS.NOT_FOUND')])
    }
    this.cdr.markForCheck()
  }

  /**
   * Loest `deviceId` auf den Geraetenamen auf. Ein Fehler (403 fuer
   * TENANT_MANAGER, Edge nicht erreichbar) fuehrt bewusst zu `unknown` und NICHT
   * zu `orphan` — sonst wuerde jeder Manager bei jedem Schluessel den
   * Loeschen-Dialog sehen.
   */
  private async resolveDevice(key: ApikeyDetail): Promise<void> {
    if (!key.deviceId) {
      this.deviceLookup.set({ state: 'none' })
      return
    }
    this.deviceLookup.set({ state: 'loading' })

    // Beim schnellen Blaettern mit den Pfeiltasten kann eine aeltere Antwort nach
    // einer neueren eintreffen — dann gehoert sie nicht mehr zum offenen Eintrag.
    const requestedFor = key._id

    try {
      const res = await this.api.find<DeviceRef>('devices', { deviceId: key.deviceId, $limit: 1 })
      if (this.id() !== requestedFor) return
      const device = res.data[0]
      if (device) {
        this.deviceLookup.set({ state: 'found', device })
      } else {
        this.deviceLookup.set({ state: 'orphan', deviceId: key.deviceId })
        this.promptOrphanOnce(key._id)
      }
    } catch {
      if (this.id() !== requestedFor) return
      this.deviceLookup.set({ state: 'unknown', deviceId: key.deviceId })
    }
    this.cdr.markForCheck()
  }

  private promptOrphanOnce(keyId: string): void {
    if (this.#orphanPrompted.has(keyId)) return
    this.#orphanPrompted.add(keyId)
    this.orphanPromptFor.set(keyId)
  }

  async onDeleteOrphan() {
    this.orphanPromptFor.set(null)
    await this.onDelete()
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
