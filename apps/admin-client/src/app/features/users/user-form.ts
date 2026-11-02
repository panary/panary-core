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
} from '@angular/core'
import {
  applyWhen,
  email,
  form,
  FormField,
  FormRoot,
  max,
  maxLength,
  min,
  minLength,
  pattern,
  required,
  type FieldState,
} from '@angular/forms/signals'
import { Router } from '@angular/router'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { AuthService } from '../../core/auth.service'
import { formatApiError } from '../../core/error-helper'
import { objectHash } from '../../core/dirty-check'

@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [FormField, FormRoot, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="panelMode() ? 'p-5 space-y-5' : 'p-8 max-w-2xl space-y-6'">
      <h1 class="text-2xl font-bold tracking-tight">
        {{ (isNew() ? 'USERS.NEW_USER' : 'USERS.EDIT_USER') | translate }}
      </h1>

      <form [formRoot]="userForm" (submit)="onSave()" class="space-y-5">
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <label for="userFirstName" class="text-xs font-medium text-ink-muted uppercase tracking-wider">{{
              'USERS.FIRST_NAME' | translate
            }}</label>
            <input
              id="userFirstName"
              [formField]="userForm.firstName"
              type="text"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink focus:border-ink
                     focus:ring-1 focus:ring-ink outline-none"
            />
          </div>
          <div class="space-y-1">
            <label for="userLastName" class="text-xs font-medium text-ink-muted uppercase tracking-wider">{{
              'USERS.LAST_NAME' | translate
            }}</label>
            <input
              id="userLastName"
              [formField]="userForm.lastName"
              type="text"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink focus:border-ink
                     focus:ring-1 focus:ring-ink outline-none"
            />
          </div>
        </div>

        <div class="space-y-1">
          <label for="userLoginname" class="text-xs font-medium text-ink-muted uppercase tracking-wider"
            >{{ 'USERS.LOGIN_NAME' | translate }} *</label
          >
          <input
            id="userLoginname"
            [formField]="userForm.loginname"
            type="text"
            [class]="inputClass(userForm.loginname())"
          />
          @if (userForm.loginname().invalid() && userForm.loginname().touched()) {
            <p class="text-red-500 dark:text-red-400 text-xs mt-1">
              @if (userForm.loginname().getError('required')) {
                {{ 'USERS.LOGIN_NAME_REQUIRED' | translate }}
              } @else if (userForm.loginname().getError('minLength')) {
                {{ 'COMMON.MIN_CHARS' | translate: { count: 2 } }}
              }
            </p>
          }
        </div>

        <div class="space-y-1">
          <label for="userEmail" class="text-xs font-medium text-ink-muted uppercase tracking-wider">{{
            'USERS.EMAIL' | translate
          }}</label>
          <input id="userEmail" [formField]="userForm.email" type="email" [class]="inputClass(userForm.email())" />
          @if (userForm.email().invalid() && userForm.email().touched()) {
            <p class="text-red-500 dark:text-red-400 text-xs mt-1">{{ 'USERS.EMAIL_INVALID' | translate }}</p>
          }
        </div>

        <div class="space-y-1">
          <label for="userPassword" class="text-xs font-medium text-ink-muted uppercase tracking-wider">
            {{ 'USERS.PASSWORD' | translate }} {{ isNew() ? '*' : ('USERS.PASSWORD_UNCHANGED' | translate) }}
          </label>
          <input
            id="userPassword"
            [formField]="userForm.password"
            type="password"
            [class]="inputClass(userForm.password())"
          />
          @if (userForm.password().invalid() && userForm.password().touched()) {
            <p class="text-red-500 dark:text-red-400 text-xs mt-1">
              @if (userForm.password().getError('required')) {
                {{ 'USERS.PASSWORD_REQUIRED' | translate }}
              } @else if (userForm.password().getError('minLength')) {
                {{ 'COMMON.MIN_CHARS' | translate: { count: 3 } }}
              }
            </p>
          }
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <label for="userRole" class="text-xs font-medium text-ink-muted uppercase tracking-wider"
              >{{ 'USERS.ROLE' | translate }} *</label
            >
            <select
              id="userRole"
              [formField]="userForm.role"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink outline-none"
            >
              <option value="tenant:staff">{{ 'ROLES.TENANT_STAFF' | translate }}</option>
              <option value="tenant:manager">{{ 'ROLES.TENANT_MANAGER' | translate }}</option>
              <option value="tenant:technician">{{ 'ROLES.TENANT_TECHNICIAN' | translate }}</option>
              <option value="tenant:owner">{{ 'ROLES.TENANT_OWNER' | translate }}</option>
            </select>
          </div>
          <div class="space-y-1">
            <label for="userFunction" class="text-xs font-medium text-ink-muted uppercase tracking-wider">{{
              'USERS.FUNCTION' | translate
            }}</label>
            <input
              id="userFunction"
              [formField]="userForm.staffRole"
              type="text"
              placeholder="z.B. Kellner, Koch"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink focus:border-ink
                     focus:ring-1 focus:ring-ink outline-none
                     placeholder-ink-faint"
            />
          </div>
        </div>

        <!-- Kontostatus (#275): nur an fremden Konten, siehe canEditStatus() -->
        @if (canEditStatus()) {
          <div class="space-y-1">
            <label for="userStatus" class="text-xs font-medium text-ink-muted uppercase tracking-wider">{{
              'USERS.STATUS' | translate
            }}</label>
            <select
              id="userStatus"
              [formField]="userForm.status"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink outline-none"
            >
              <option value="ACTIVE">{{ 'USERS.STATUS_ACTIVE' | translate }}</option>
              <option value="ARCHIVED">{{ 'USERS.STATUS_ARCHIVED' | translate }}</option>
              @if (user().status === 'REJECTED') {
                <!-- Nur sichtbar, wenn das Konto diesen Status TRAEGT: Ein select
                     ohne passende option wuerde das Modell still leerraeumen.
                     REJECTED wird nicht aktiv angeboten (Registrierungs-Ablehnung). -->
                <option value="REJECTED">{{ 'USERS.STATUS_REJECTED' | translate }}</option>
              }
            </select>
            <p class="text-xs text-ink-muted dark:text-ink-faint">
              {{ (user().status === 'ACTIVE' ? 'USERS.STATUS_HINT_ACTIVE' : 'USERS.STATUS_HINT_BLOCKED') | translate }}
            </p>
          </div>
        }

        <!-- POS-Benutzer -->
        <div class="flex items-center gap-6 pt-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <input [formField]="userForm.isPosUser" type="checkbox" class="w-4 h-4 accent-ink" />
            <span class="text-sm text-ink-muted dark:text-ink">{{ 'USERS.POS_USER' | translate }}</span>
          </label>
        </div>

        @if (user().isPosUser) {
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <label for="employeeNumber" class="text-xs font-medium text-ink-muted uppercase tracking-wider">
                {{ 'USERS.EMPLOYEE_NUMBER' | translate }}
              </label>
              <input
                id="employeeNumber"
                [formField]="userForm.employeeNumber"
                type="text"
                inputmode="numeric"
                placeholder="z.B. 100001"
                [class]="inputClass(userForm.employeeNumber())"
              />
              @if (userForm.employeeNumber().invalid() && userForm.employeeNumber().touched()) {
                <p class="text-red-500 dark:text-red-400 text-xs mt-1">
                  {{ 'USERS.EMPLOYEE_NUMBER_INVALID' | translate }}
                </p>
              }
            </div>
            <div class="space-y-1">
              <label for="posPin" class="text-xs font-medium text-ink-muted uppercase tracking-wider">
                {{ 'USERS.POS_PIN' | translate }}
                @if (!isNew() && hasPosPin() && !editingPin()) {
                  <span class="text-ink-faint normal-case tracking-normal">({{ 'USERS.PIN_SET' | translate }})</span>
                }
              </label>
              @if (!isNew() && hasPosPin() && !editingPin()) {
                <button
                  type="button"
                  (click)="editingPin.set(true); userForm.posPin().value.set('')"
                  class="w-full text-left bg-surface-input border border-line-soft rounded-lg p-3
                         text-ink-faint hover:border-line-strong transition cursor-pointer"
                >
                  &#x2022;&#x2022;&#x2022;&#x2022; &mdash; {{ 'USERS.PIN_CLICK_TO_CHANGE' | translate }}
                </button>
              } @else {
                <input
                  id="posPin"
                  [formField]="userForm.posPin"
                  type="text"
                  inputmode="numeric"
                  [placeholder]="isNew() ? 'z.B. 1234' : 'Neuen PIN eingeben'"
                  [class]="inputClass(userForm.posPin())"
                />
                @if (userForm.posPin().invalid() && userForm.posPin().touched()) {
                  <p class="text-red-500 dark:text-red-400 text-xs mt-1">{{ 'USERS.POS_PIN_INVALID' | translate }}</p>
                }
              }
            </div>
          </div>
        }

        <!-- Personalessen & Rabatt -->
        <div class="border-t border-line-soft pt-4 space-y-4">
          <p class="text-xs font-medium text-ink-muted uppercase tracking-wider">
            {{ 'USERS.STAFF_MEAL_DISCOUNT' | translate }}
          </p>

          <label class="flex items-center gap-2 cursor-pointer">
            <input [formField]="userForm.allowStaffMealOrders" type="checkbox" class="w-4 h-4 accent-ink" />
            <span class="text-sm text-ink-muted dark:text-ink">{{ 'USERS.STAFF_MEAL_ELIGIBLE' | translate }}</span>
          </label>

          @if (user().allowStaffMealOrders) {
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-1">
                <label for="discountType" class="text-xs text-ink-faint uppercase tracking-wider">{{
                  'USERS.DISCOUNT_TYPE' | translate
                }}</label>
                <select
                  id="discountType"
                  [formField]="userForm.discountType"
                  class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                         text-ink outline-none"
                >
                  <option value="percent">{{ 'USERS.DISCOUNT_PERCENT' | translate }}</option>
                  <option value="amount">{{ 'USERS.DISCOUNT_AMOUNT' | translate }}</option>
                </select>
              </div>
              <div class="space-y-1">
                <label for="discountValue" class="text-xs text-ink-faint uppercase tracking-wider">
                  {{
                    (user().discountType === 'percent' ? 'USERS.DISCOUNT_LABEL_PERCENT' : 'USERS.DISCOUNT_LABEL_AMOUNT')
                      | translate
                  }}
                </label>
                <input
                  id="discountValue"
                  [formField]="userForm.discount"
                  type="number"
                  step="0.5"
                  placeholder="z.B. 50"
                  class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                         text-ink focus:border-ink
                         focus:ring-1 focus:ring-ink outline-none font-mono"
                />
              </div>
            </div>
          }
        </div>

        <!-- Fehleranzeige -->
        @if (errors().length > 0) {
          <div
            class="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded-lg p-4 space-y-1"
          >
            @for (err of errors(); track err) {
              <p class="text-red-500 dark:text-red-400 text-sm flex items-start gap-2">
                <span class="shrink-0 mt-0.5">&#x2715;</span>
                <span>{{ err }}</span>
              </p>
            }
          </div>
        }

        <div class="flex gap-3 pt-4">
          <button
            type="submit"
            [disabled]="saving() || savedSuccess() || userForm().invalid()"
            [class]="
              'save-btn ' + (savedSuccess() ? 'save-btn--success' : saving() ? 'save-btn--saving' : 'save-btn--default')
            "
            [class.opacity-50]="userForm().invalid() && !saving() && !savedSuccess()"
            [class.cursor-not-allowed]="userForm().invalid()"
          >
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
          <button
            type="button"
            (click)="onCancel()"
            class="bg-surface-bg border border-line-soft text-ink-muted dark:text-ink
                   px-6 py-3 rounded-xl text-sm hover:bg-line transition"
          >
            {{ 'COMMON.CANCEL' | translate }}
          </button>
        </div>
      </form>
    </div>
  `,
})
export class UserFormComponent {
  private api = inject(ApiService)
  private router = inject(Router)
  private cdr = inject(ChangeDetectorRef)
  private t = inject(TranslateService)
  private auth = inject(AuthService)

  id = input<string>()
  panelMode = input(false)
  saved = output<string | void>()
  closed = output<void>()

  isNew = signal(true)
  saving = signal(false)
  savedSuccess = signal(false)
  errors = signal<string[]>([])
  hasPosPin = signal(false)
  editingPin = signal(false)
  private originalHash = ''

  /**
   * Das Status-Feld erscheint nur beim Bearbeiten eines FREMDEN Kontos (#275).
   *
   * Nicht beim Anlegen: Ein neuer Nutzer ist immer `ACTIVE`, ein Auswahlfeld
   * dafuer waere eine Falle. Nicht am eigenen Datensatz: Wer sich selbst
   * archiviert, sperrt sich sofort aus — der Login-Guard prueft bei jedem
   * Request frisch (ADR 0028), die eigene Sitzung stirbt also noch im
   * Speichern-Klick.
   *
   * Bewusst KEINE Rollen-Pruefung hier: Wer fremde Datensaetze nicht patchen
   * darf, scheitert serverseitig ohnehin an `restrictUserSelfPatch` — und zwar
   * an JEDEM Feld, nicht nur an `status`. Eine Rollenliste im Client waere die
   * vierte Kopie derselben Wahrheit, und genau die hat #275 verursacht.
   */
  canEditStatus = computed(() => !this.isNew() && !!this.id() && this.id() !== this.auth.user()?._id)

  isDirty(): boolean {
    if (this.isNew()) return !!this.user().loginname
    return objectHash(this.user()) !== this.originalHash
  }

  async saveAndContinue(): Promise<boolean> {
    await this.onSave()
    return this.errors().length === 0
  }

  discardChanges(): void {
    this.originalHash = objectHash(this.user())
  }

  readonly user = signal({
    loginname: '',
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    role: 'tenant:staff',
    staffRole: '',
    status: 'ACTIVE',
    isPosUser: true,
    posPin: '',
    employeeNumber: '',
    allowStaffMealOrders: false,
    discountType: 'percent' as 'percent' | 'amount',
    discount: 0 as number | null,
  })

  readonly userForm = form(this.user, u => {
    required(u.loginname)
    minLength(u.loginname, 2)
    maxLength(u.loginname, 30)
    email(u.email)
    required(u.password, { when: () => this.isNew() })
    minLength(u.password, 3)
    // Personalnummer und PIN zaehlen nur fuer POS-Benutzer; sonst sind die Felder ausgeblendet.
    applyWhen(
      u,
      ({ valueOf }) => valueOf(u.isPosUser),
      pos => {
        pattern(pos.employeeNumber, /^\d{6}$/)
        pattern(pos.posPin, /^\d{4,6}$/)
      },
    )
    applyWhen(
      u,
      ({ valueOf }) => valueOf(u.allowStaffMealOrders),
      meal => {
        min(meal.discount, 0)
        max(meal.discount, ({ valueOf }) => (valueOf(meal.discountType) === 'percent' ? 100 : 9999))
      },
    )
  })

  private readonly baseInputClass = 'w-full bg-surface-input border rounded-lg p-3 text-ink focus:ring-1 outline-none'

  inputClass(state: FieldState<string>): string {
    if (!state.dirty()) return `${this.baseInputClass} border-line-soft focus:border-ink focus:ring-ink`
    if (state.invalid()) return `${this.baseInputClass} border-red-500/50 focus:border-red-400 focus:ring-red-400`
    return `${this.baseInputClass} border-green-500/30 focus:border-green-400 focus:ring-green-400`
  }

  constructor() {
    // id() bewusst getrackt, Loader-Body via untracked() entkoppelt (angular.md §2.1).
    effect(() => {
      const userId = this.id()
      untracked(() => void this.loadUser(userId))
    })
  }

  // ngOnInit entfernt — Initialisierungslogik läuft über effect() im Konstruktor

  private async loadUser(userId: string | undefined) {
    this.errors.set([])
    this.userForm().reset({
      loginname: '',
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      role: 'tenant:staff',
      staffRole: '',
      status: 'ACTIVE',
      isPosUser: true,
      posPin: '',
      employeeNumber: '',
      allowStaffMealOrders: false,
      discountType: 'percent',
      discount: 0,
    })

    if (!userId || userId === 'new') {
      this.isNew.set(true)
      return
    }

    this.isNew.set(false)
    try {
      const user = await this.api.get<any>('users', userId)
      this.hasPosPin.set(!!user.hasPosPin)
      this.editingPin.set(false)
      this.user.set({
        loginname: user.loginname || '',
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        password: '',
        role: user.role || 'tenant:staff',
        staffRole: user.staffRole || '',
        status: user.status || 'ACTIVE',
        isPosUser: user.isPosUser ?? true,
        posPin: '',
        employeeNumber: user.employeeNumber || '',
        allowStaffMealOrders: user.allowStaffMealOrders ?? false,
        discountType: user.discountDetails?.discountType || 'percent',
        discount: user.discountDetails?.discount ?? 0,
      })
      this.originalHash = objectHash(this.user())
    } catch {
      this.errors.set([this.t.instant('USERS.NOT_FOUND')])
    }
    this.cdr.markForCheck()
  }

  async onSave() {
    if (this.userForm().invalid()) {
      this.userForm().markAsTouched()
      return
    }

    this.saving.set(true)
    this.errors.set([])

    try {
      const data: any = { ...this.user() }
      // Booleans explizit koerzieren (HTML-Checkboxen können 1/0 statt true/false liefern)
      data.isPosUser = !!data.isPosUser
      data.allowStaffMealOrders = !!data.allowStaffMealOrders
      if (!data.password) delete data.password
      if (!data.posPin) delete data.posPin
      if (!data.staffRole) delete data.staffRole
      if (!data.employeeNumber) delete data.employeeNumber
      // `email` ebenso strippen (#288): `loadUser` macht aus einem leeren Feld
      // den Leerstring, und AJV prueft `format: 'email'` auf jedem nicht-
      // undefined-Wert. Ein POS-Mitarbeiter ohne E-Mail (Personalnummer + PIN)
      // war dadurch ueberhaupt nicht speicherbar — jeder Patch endete in 400
      // `must match format "email"` auf einem Feld, das der Bediener nie
      // angefasst hatte. Bewusste Folge: eine gesetzte E-Mail laesst sich hier
      // nur ueberschreiben, nicht entfernen. Leeren erforderte `''` oder `null`
      // in `userSchema` (@panary/users/domain) — geteilt mit panary-cloud und
      // damit eine Release-/Pin-Bump-Kette fuer einen Randfall.
      if (!data.email) delete data.email
      // `status` nur senden, wenn das Feld angeboten wurde. Sonst wuerde der
      // Self-Service-Fall (Mitarbeiter aendert sein eigenes Passwort) an
      // `restrictUserSelfPatch` scheitern: `status` steht nicht in
      // SELF_PATCHABLE_FIELDS, der Patch endet in 403 — ohne dass der Nutzer
      // etwas am Status geaendert haette.
      if (!this.canEditStatus()) delete data.status

      // discountDetails als verschachteltes Objekt senden
      if (data.allowStaffMealOrders) {
        data.discountDetails = {
          discountType: data.discountType,
          discount: Number(data.discount) || 0,
        }
      } else {
        data.allowStaffMealOrders = false
        delete data.discountDetails
      }
      delete data.discountType
      delete data.discount

      let createdId: string | undefined
      if (this.isNew()) {
        const result = await this.api.create<any>('users', data)
        createdId = result?._id
      } else {
        await this.api.patch('users', this.id()!, data)
      }
      this.originalHash = objectHash(this.user())
      this.savedSuccess.set(true)
      this.cdr.markForCheck()
      if (this.panelMode()) this.saved.emit(createdId)
      setTimeout(() => {
        this.savedSuccess.set(false)
        this.cdr.markForCheck()
        if (!this.panelMode()) this.router.navigate(['/users'])
      }, 2000)
    } catch (e: any) {
      const msg = formatApiError(e)
      this.errors.set(msg.split('\n'))
    }
    this.saving.set(false)
  }

  onCancel() {
    if (this.panelMode()) {
      this.closed.emit()
    } else {
      this.router.navigate(['/users'])
    }
  }
}
