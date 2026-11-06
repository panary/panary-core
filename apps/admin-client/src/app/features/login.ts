import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { form, FormField, FormRoot, required } from '@angular/forms/signals'
import { Router } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { PanaryLogoComponent } from '@panary/shared/ui-common'
import { AuthService } from '../core/auth.service'
import { EdgeVersionService } from '../core/edge-version.service'

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormField, FormRoot, TranslateModule, PanaryLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative min-h-screen overflow-hidden bg-surface-bg text-ink flex items-center justify-center p-6">
      <div class="auth-dots absolute inset-0" aria-hidden="true"></div>
      <div class="relative w-full max-w-sm space-y-8">
        <div class="text-center">
          <lib-panary-logo class="mb-6" [size]="2.5" />
          <h1 class="text-2xl font-bold tracking-tight">{{ 'NAV.ADMIN_PANEL' | translate }}</h1>
          <p class="text-ink-faint mt-1 text-sm">{{ 'LOGIN.SUBTITLE' | translate }}</p>
        </div>

        <form [formRoot]="loginForm" (submit)="onLogin()" class="space-y-4">
          <div class="space-y-1">
            <label for="login-email" class="text-xs font-medium text-ink-muted uppercase tracking-wider">
              {{ 'USERS.EMAIL' | translate }}
            </label>
            <input
              id="login-email"
              [formField]="loginForm.email"
              type="email"
              autocomplete="username"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink focus:border-ink
                     focus:ring-1 focus:ring-ink outline-none
                     placeholder-ink-faint"
              placeholder="name@firma.de"
            />
          </div>

          <div class="space-y-1">
            <label for="login-password" class="text-xs font-medium text-ink-muted uppercase tracking-wider">
              {{ 'USERS.PASSWORD' | translate }}
            </label>
            <input
              id="login-password"
              [formField]="loginForm.password"
              type="password"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink focus:border-ink
                     focus:ring-1 focus:ring-ink outline-none
                     placeholder-ink-faint"
              placeholder="••••••••"
            />
          </div>

          @if (error()) {
            <p class="text-red-500 dark:text-red-400 text-sm">{{ error()! | translate }}</p>
          }

          <button
            type="submit"
            [disabled]="loading() || loginForm().invalid()"
            class="w-full bg-ink text-surface-panel font-bold py-3 rounded-xl text-base
                   hover:bg-ink/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            @if (loading()) {
              <span class="flex items-center justify-center gap-2">
                <span class="w-4 h-4 border-2 border-line-soft border-t-transparent rounded-full animate-spin"></span>
                {{ 'LOGIN.LOGGING_IN' | translate }}
              </span>
            } @else {
              {{ 'LOGIN.LOGIN' | translate }}
            }
          </button>
        </form>

        @if (edgeVersion(); as version) {
          <p class="text-center text-xs text-ink-faint font-mono tabular-nums" data-testid="login-edge-version">
            v{{ version }}
          </p>
        }
      </div>
    </div>
  `,
})
export class LoginComponent {
  private auth = inject(AuthService)
  private router = inject(Router)
  private edgeVersionService = inject(EdgeVersionService)

  readonly credentials = signal({ email: '', password: '' })
  readonly loginForm = form(this.credentials, c => {
    required(c.email)
    required(c.password)
  })
  loading = signal(false)
  error = signal<string | null>(null)
  /** Version des laufenden Edge-Servers (core#1354): Nach einem Update zeigt ein Neuladen, ob er sie fährt. */
  readonly edgeVersion = signal<string | null>(null)

  constructor() {
    void this.edgeVersionService.load().then(version => this.edgeVersion.set(version))
  }

  async onLogin() {
    if (this.loginForm().invalid()) return
    const { email, password } = this.credentials()
    this.loading.set(true)
    this.error.set(null)

    const success = await this.auth.login(email, password)

    if (success) {
      this.router.navigate(['/'])
    } else {
      this.error.set('LOGIN.ERROR')
    }
    this.loading.set(false)
  }
}
