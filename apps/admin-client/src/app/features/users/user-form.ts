import { ChangeDetectionStrategy, Component, inject, signal, OnInit, input } from '@angular/core'
import { FormsModule, NgForm } from '@angular/forms'
import { Router } from '@angular/router'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'

@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-8 max-w-2xl space-y-6">
      <h1 class="text-2xl font-bold tracking-tight">{{ isNew() ? 'Neuer Benutzer' : 'Benutzer bearbeiten' }}</h1>

      <form #f="ngForm" (ngSubmit)="onSave(f)" class="space-y-5">
        <div class="grid grid-cols-2 gap-4">
          <!-- Vorname -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Vorname</label>
            <input [(ngModel)]="form.firstName" name="firstName" type="text"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                     focus:border-white focus:ring-1 focus:ring-white outline-none" />
          </div>
          <!-- Nachname -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Nachname</label>
            <input [(ngModel)]="form.lastName" name="lastName" type="text"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                     focus:border-white focus:ring-1 focus:ring-white outline-none" />
          </div>
        </div>

        <!-- Login-Name -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Login-Name *</label>
          <input [(ngModel)]="form.loginname" name="loginname" #loginname="ngModel"
            type="text" required minlength="2" maxlength="30"
            [class]="inputClass(loginname)" />
          @if (loginname.invalid && loginname.touched) {
            <p class="text-red-400 text-xs mt-1">
              @if (loginname.errors?.['required']) { Login-Name ist erforderlich. }
              @else if (loginname.errors?.['minlength']) { Mindestens 2 Zeichen. }
            </p>
          }
        </div>

        <!-- E-Mail -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">E-Mail</label>
          <input [(ngModel)]="form.email" name="email" #email="ngModel" type="email" email
            [class]="inputClass(email)" />
          @if (email.invalid && email.touched) {
            <p class="text-red-400 text-xs mt-1">Bitte eine gültige E-Mail-Adresse eingeben.</p>
          }
        </div>

        <!-- Passwort -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Passwort {{ isNew() ? '*' : '(leer lassen = unverändert)' }}
          </label>
          <input [(ngModel)]="form.password" name="password" #password="ngModel"
            type="password" [required]="isNew()" minlength="3"
            [class]="inputClass(password)" />
          @if (password.invalid && password.touched) {
            <p class="text-red-400 text-xs mt-1">
              @if (password.errors?.['required']) { Passwort ist bei neuen Benutzern erforderlich. }
              @else if (password.errors?.['minlength']) { Mindestens 3 Zeichen. }
            </p>
          }
        </div>

        <!-- Rolle / Funktion -->
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Rolle *</label>
            <select [(ngModel)]="form.role" name="role"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white outline-none">
              <option value="tenant:staff">Mitarbeiter</option>
              <option value="tenant:manager">Manager</option>
              <option value="tenant:owner">Inhaber</option>
            </select>
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Funktion</label>
            <input [(ngModel)]="form.staffRole" name="staffRole" type="text" placeholder="z.B. Kellner, Koch"
              class="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white
                     focus:border-white focus:ring-1 focus:ring-white outline-none placeholder-gray-600" />
          </div>
        </div>

        <!-- POS-Benutzer -->
        <div class="flex items-center gap-6 pt-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <input [(ngModel)]="form.isPosUser" name="isPosUser" type="checkbox"
              class="w-4 h-4 accent-white" />
            <span class="text-sm text-gray-300">POS-Benutzer (erscheint im POS-Login)</span>
          </label>
        </div>

        @if (form.isPosUser) {
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Personalnummer (6 Ziffern, wird auto-generiert wenn leer)</label>
            <input [(ngModel)]="form.employeeNumber" name="employeeNumber" #employeeNumber="ngModel"
              type="text" minlength="6" maxlength="6" pattern="[0-9]*"
              inputmode="numeric" placeholder="z.B. 100001"
              [class]="inputClass(employeeNumber)" />
            @if (employeeNumber.invalid && employeeNumber.touched) {
              <p class="text-red-400 text-xs mt-1">
                @if (employeeNumber.errors?.['minlength']) { Personalnummer muss genau 6 Ziffern haben. }
                @else if (employeeNumber.errors?.['pattern']) { Personalnummer darf nur Ziffern enthalten. }
              </p>
            }
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">POS-PIN (optional, 4–6 Ziffern)</label>
            <input [(ngModel)]="form.posPin" name="posPin" #posPin="ngModel"
              type="text" minlength="4" maxlength="6" pattern="[0-9]*"
              inputmode="numeric" placeholder="z.B. 1234"
              [class]="inputClass(posPin)" />
            @if (posPin.invalid && posPin.touched) {
              <p class="text-red-400 text-xs mt-1">
                @if (posPin.errors?.['minlength']) { PIN muss mindestens 4 Ziffern haben. }
                @else if (posPin.errors?.['pattern']) { PIN darf nur Ziffern enthalten. }
              </p>
            }
            <p class="text-gray-600 text-xs">Schnellanmeldung am POS-Terminal ohne Passwort.</p>
          </div>
        }

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
export class UserFormComponent implements OnInit {
  private api = inject(ApiService)
  private router = inject(Router)

  id = input<string>()
  isNew = signal(true)
  saving = signal(false)
  errors = signal<string[]>([])

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
  }

  private readonly baseInputClass =
    'w-full bg-gray-900 border rounded-lg p-3 text-white focus:ring-1 outline-none'

  inputClass(ctrl: any): string {
    if (!ctrl || ctrl.pristine) return `${this.baseInputClass} border-gray-800 focus:border-white focus:ring-white`
    if (ctrl.invalid) return `${this.baseInputClass} border-red-500/50 focus:border-red-400 focus:ring-red-400`
    return `${this.baseInputClass} border-green-500/30 focus:border-green-400 focus:ring-green-400`
  }

  async ngOnInit() {
    const userId = this.id()
    if (userId && userId !== 'new') {
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
        }
      } catch {
        this.errors.set(['Benutzer nicht gefunden.'])
      }
    }
  }

  async onSave(f: NgForm) {
    if (f.invalid) {
      // Alle Controls als touched markieren, damit Fehlermeldungen erscheinen
      Object.values(f.controls).forEach(c => c.markAsTouched())
      return
    }

    this.saving.set(true)
    this.errors.set([])

    try {
      const data: any = { ...this.form }
      if (!data.password) delete data.password
      if (!data.posPin) delete data.posPin
      if (!data.staffRole) delete data.staffRole
      if (!data.employeeNumber) delete data.employeeNumber

      if (this.isNew()) {
        await this.api.create('users', data)
      } else {
        await this.api.patch('users', this.id()!, data)
      }
      this.router.navigate(['/users'])
    } catch (e: any) {
      const msg = formatApiError(e)
      this.errors.set(msg.split('\n'))
    }
    this.saving.set(false)
  }

  onCancel() {
    this.router.navigate(['/users'])
  }
}
