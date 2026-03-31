import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, signal, OnInit, input, output, effect, viewChild } from '@angular/core'
import { FormsModule, NgForm } from '@angular/forms'
import { Router } from '@angular/router'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'
import { objectHash } from '../../core/dirty-check'

@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="panelMode() ? 'p-5 space-y-5' : 'p-8 max-w-2xl space-y-6'">
      <h1 class="text-2xl font-bold tracking-tight">{{ isNew() ? 'Neuer Benutzer' : 'Benutzer bearbeiten' }}</h1>

      <form #f="ngForm" (ngSubmit)="onSave(f)" class="space-y-5">
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Vorname</label>
            <input [(ngModel)]="form.firstName" name="firstName" type="text"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Nachname</label>
            <input [(ngModel)]="form.lastName" name="lastName" type="text"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
          </div>
        </div>

        <div class="space-y-1">
          <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Login-Name *</label>
          <input [(ngModel)]="form.loginname" name="loginname" #loginname="ngModel"
            type="text" required minlength="2" maxlength="30"
            [class]="inputClass(loginname)" />
          @if (loginname.invalid && loginname.touched) {
            <p class="text-red-500 dark:text-red-400 text-xs mt-1">
              @if (loginname.errors?.['required']) { Login-Name ist erforderlich. }
              @else if (loginname.errors?.['minlength']) { Mindestens 2 Zeichen. }
            </p>
          }
        </div>

        <div class="space-y-1">
          <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">E-Mail</label>
          <input [(ngModel)]="form.email" name="email" #email="ngModel" type="email" email
            [class]="inputClass(email)" />
          @if (email.invalid && email.touched) {
            <p class="text-red-500 dark:text-red-400 text-xs mt-1">Bitte eine gültige E-Mail-Adresse eingeben.</p>
          }
        </div>

        <div class="space-y-1">
          <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
            Passwort {{ isNew() ? '*' : '(leer lassen = unverändert)' }}
          </label>
          <input [(ngModel)]="form.password" name="password" #password="ngModel"
            type="password" [required]="isNew()" minlength="3"
            [class]="inputClass(password)" />
          @if (password.invalid && password.touched) {
            <p class="text-red-500 dark:text-red-400 text-xs mt-1">
              @if (password.errors?.['required']) { Passwort ist bei neuen Benutzern erforderlich. }
              @else if (password.errors?.['minlength']) { Mindestens 3 Zeichen. }
            </p>
          }
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Rolle *</label>
            <select [(ngModel)]="form.role" name="role"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white outline-none">
              <option value="tenant:staff">Mitarbeiter</option>
              <option value="tenant:manager">Manager</option>
              <option value="tenant:owner">Inhaber</option>
            </select>
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Funktion</label>
            <input [(ngModel)]="form.staffRole" name="staffRole" type="text" placeholder="z.B. Kellner, Koch"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none
                     placeholder-slate-400 dark:placeholder-gray-600" />
          </div>
        </div>

        <!-- POS-Benutzer -->
        <div class="flex items-center gap-6 pt-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <input [(ngModel)]="form.isPosUser" name="isPosUser" type="checkbox"
              class="w-4 h-4 accent-slate-900 dark:accent-white" />
            <span class="text-sm text-slate-600 dark:text-gray-300">POS-Benutzer (erscheint im POS-Login)</span>
          </label>
        </div>

        @if (form.isPosUser) {
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                Personalnummer (6 Ziffern)
              </label>
              <input [(ngModel)]="form.employeeNumber" name="employeeNumber" #employeeNumber="ngModel"
                type="text" minlength="6" maxlength="6" pattern="[0-9]*"
                inputmode="numeric" placeholder="z.B. 100001"
                [class]="inputClass(employeeNumber)" />
              @if (employeeNumber.invalid && employeeNumber.touched) {
                <p class="text-red-500 dark:text-red-400 text-xs mt-1">Genau 6 Ziffern.</p>
              }
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                POS-PIN (4–6 Ziffern)
              </label>
              <input [(ngModel)]="form.posPin" name="posPin" #posPin="ngModel"
                type="text" minlength="4" maxlength="6" pattern="[0-9]*"
                inputmode="numeric" placeholder="z.B. 1234"
                [class]="inputClass(posPin)" />
              @if (posPin.invalid && posPin.touched) {
                <p class="text-red-500 dark:text-red-400 text-xs mt-1">4–6 Ziffern.</p>
              }
            </div>
          </div>
        }

        <!-- Personalessen & Rabatt -->
        <div class="border-t border-slate-200 dark:border-gray-800 pt-4 space-y-4">
          <p class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Personalessen & Rabatt</p>

          <label class="flex items-center gap-2 cursor-pointer">
            <input [(ngModel)]="form.allowStaffMealOrders" name="allowStaffMealOrders" type="checkbox"
              class="w-4 h-4 accent-slate-900 dark:accent-white" />
            <span class="text-sm text-slate-600 dark:text-gray-300">Personalessen berechtigt</span>
          </label>

          @if (form.allowStaffMealOrders) {
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-1">
                <label for="discountType" class="text-xs text-slate-400 dark:text-gray-500 uppercase tracking-wider">Rabatt-Typ</label>
                <select id="discountType" [(ngModel)]="form.discountType" name="discountType"
                  class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                         text-slate-900 dark:text-white outline-none">
                  <option value="percent">Prozent (%)</option>
                  <option value="amount">Fester Betrag (&euro;)</option>
                </select>
              </div>
              <div class="space-y-1">
                <label for="discountValue" class="text-xs text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                  {{ form.discountType === 'percent' ? 'Rabatt (%)' : 'Rabatt (\u20AC)' }}
                </label>
                <input id="discountValue" [(ngModel)]="form.discount" name="discount" type="number" step="0.5" min="0"
                  [max]="form.discountType === 'percent' ? 100 : 9999"
                  placeholder="z.B. 50"
                  class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                         text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                         focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none font-mono" />
              </div>
            </div>
          }
        </div>

        <!-- Fehleranzeige -->
        @if (errors().length > 0) {
          <div class="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded-lg p-4 space-y-1">
            @for (err of errors(); track err) {
              <p class="text-red-500 dark:text-red-400 text-sm flex items-start gap-2">
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
            class="bg-slate-100 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-slate-600
                   dark:text-gray-300 px-6 py-3 rounded-xl text-sm hover:bg-slate-200 dark:hover:bg-gray-800 transition">
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  `,
})
export class UserFormComponent implements OnInit {
  private api = inject(ApiService)
  private router = inject(Router)
  private cdr = inject(ChangeDetectorRef)

  id = input<string>()
  panelMode = input(false)
  saved = output<void>()
  closed = output<void>()

  isNew = signal(true)
  saving = signal(false)
  savedSuccess = signal(false)
  errors = signal<string[]>([])
  private formRef = viewChild<NgForm>('f')
  private originalHash = ''

  isDirty(): boolean {
    if (this.isNew()) return !!this.form.loginname
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

  form = {
    loginname: '',
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    role: 'tenant:staff',
    staffRole: '',
    isPosUser: true,
    posPin: '',
    employeeNumber: '',
    allowStaffMealOrders: false,
    discountType: 'percent' as 'percent' | 'amount',
    discount: 0,
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
      const userId = this.id()
      this.loadUser(userId)
    })
  }

  async ngOnInit() {}

  private async loadUser(userId: string | undefined) {
    this.formRef()?.resetForm()
    this.errors.set([])
    this.form = {
      loginname: '', firstName: '', lastName: '', email: '', password: '',
      role: 'tenant:staff', staffRole: '', isPosUser: true, posPin: '',
      employeeNumber: '', allowStaffMealOrders: false, discountType: 'percent', discount: 0,
    }

    if (!userId || userId === 'new') {
      this.isNew.set(true)
      return
    }

    this.isNew.set(false)
    try {
      const user = await this.api.get<any>('users', userId)
      this.form = {
        loginname: user.loginname || '',
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        password: '',
        role: user.role || 'tenant:staff',
        staffRole: user.staffRole || '',
        isPosUser: user.isPosUser ?? true,
        posPin: user.posPin || '',
        employeeNumber: user.employeeNumber || '',
        allowStaffMealOrders: user.allowStaffMealOrders ?? false,
        discountType: user.discountDetails?.discountType || 'percent',
        discount: user.discountDetails?.discount ?? 0,
      }
      this.originalHash = objectHash(this.form)
    } catch {
      this.errors.set(['Benutzer nicht gefunden.'])
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
      // Booleans explizit koerzieren (HTML-Checkboxen können 1/0 statt true/false liefern)
      data.isPosUser = !!data.isPosUser
      data.allowStaffMealOrders = !!data.allowStaffMealOrders
      if (!data.password) delete data.password
      if (!data.posPin) delete data.posPin
      if (!data.staffRole) delete data.staffRole
      if (!data.employeeNumber) delete data.employeeNumber

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

      if (this.isNew()) {
        await this.api.create('users', data)
      } else {
        await this.api.patch('users', this.id()!, data)
      }
      this.originalHash = objectHash(this.form)
      this.savedSuccess.set(true)
      this.cdr.markForCheck()
      if (this.panelMode()) this.saved.emit()
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
