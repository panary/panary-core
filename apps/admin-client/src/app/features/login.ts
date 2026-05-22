import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { AuthService } from '../core/auth.service'

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-slate-50 dark:bg-black flex items-center justify-center p-6">
      <div class="w-full max-w-sm space-y-8">
        <div class="text-center">
          <img src="assets/panary_logo_mono.svg" alt="Panary"
               class="h-8 mx-auto mb-6 opacity-60" />
          <h1 class="text-2xl font-bold tracking-tight">{{ 'NAV.ADMIN_PANEL' | translate }}</h1>
          <p class="text-slate-400 dark:text-gray-500 mt-1 text-sm">{{ 'LOGIN.SUBTITLE' | translate }}</p>
        </div>

        <form (ngSubmit)="onLogin()" class="space-y-4">
          <div class="space-y-1">
            <label for="login-email" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
              {{ 'USERS.EMAIL' | translate }}
            </label>
            <input
              id="login-email"
              [(ngModel)]="email" name="email" type="email" autocomplete="username"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none
                     placeholder-slate-400 dark:placeholder-gray-600"
              placeholder="name@firma.de" />
          </div>

          <div class="space-y-1">
            <label for="login-password" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
              {{ 'USERS.PASSWORD' | translate }}
            </label>
            <input
              id="login-password"
              [(ngModel)]="password" name="password" type="password"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none
                     placeholder-slate-400 dark:placeholder-gray-600"
              placeholder="••••••••" />
          </div>

          @if (error()) {
            <p class="text-red-500 dark:text-red-400 text-sm">{{ error()! | translate }}</p>
          }

          <button
            type="submit"
            [disabled]="loading()"
            class="w-full bg-slate-900 dark:bg-white text-white dark:text-black font-bold py-3 rounded-xl text-base
                   hover:bg-slate-800 dark:hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed">
            @if (loading()) {
              <span class="flex items-center justify-center gap-2">
                <span class="w-4 h-4 border-2 border-white dark:border-black border-t-transparent rounded-full animate-spin"></span>
                {{ 'LOGIN.LOGGING_IN' | translate }}
              </span>
            } @else {
              {{ 'LOGIN.LOGIN' | translate }}
            }
          </button>
        </form>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private auth = inject(AuthService)
  private router = inject(Router)

  email = ''
  password = ''
  loading = signal(false)
  error = signal<string | null>(null)

  async onLogin() {
    if (!this.email || !this.password) return
    this.loading.set(true)
    this.error.set(null)

    const success = await this.auth.login(this.email, this.password)

    if (success) {
      this.router.navigate(['/'])
    } else {
      this.error.set('LOGIN.ERROR')
    }
    this.loading.set(false)
  }
}
