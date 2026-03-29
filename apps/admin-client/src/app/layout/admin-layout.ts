import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { AuthService } from '../core/auth.service'
import { ThemeServiceService } from '@panary-core/shared/data-access-theme'

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="h-screen bg-slate-50 dark:bg-black flex overflow-hidden">
      <!-- Sidebar -->
      <aside class="w-60 bg-white dark:bg-gray-950 border-r border-slate-200 dark:border-gray-800
                     flex flex-col shrink-0">
        <!-- Logo -->
        <div class="p-5 border-b border-slate-200 dark:border-gray-800">
          <img src="assets/panary_logo_dark.svg" alt="Panary" class="h-7 invert dark:invert-0" />
          <p class="text-[10px] text-slate-400 dark:text-gray-600 mt-1.5 uppercase tracking-widest">
            Admin Panel
          </p>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 p-3 space-y-1">
          @for (item of navItems; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="bg-slate-100 dark:bg-gray-800 text-slate-900 dark:text-white"
               class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-500 dark:text-gray-400
                      hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-gray-900 transition">
              <span class="text-base">{{ item.icon }}</span>
              {{ item.label }}
            </a>
          }
        </nav>

        <!-- Theme Toggle + User Info -->
        <div class="p-4 border-t border-slate-200 dark:border-gray-800">
          <!-- Theme-Umschalter -->
          <div class="flex items-center gap-1 mb-3 bg-slate-100 dark:bg-gray-900 rounded-lg p-1">
            <button (click)="setTheme('light')"
                    [class]="themeService.theme === 'light'
                      ? 'flex-1 text-xs py-1.5 rounded-md bg-white dark:bg-gray-800 text-slate-900 dark:text-white shadow-sm font-medium transition'
                      : 'flex-1 text-xs py-1.5 rounded-md text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 transition'">
              ☀
            </button>
            <button (click)="setTheme('dark')"
                    [class]="themeService.theme === 'dark'
                      ? 'flex-1 text-xs py-1.5 rounded-md bg-white dark:bg-gray-800 text-slate-900 dark:text-white shadow-sm font-medium transition'
                      : 'flex-1 text-xs py-1.5 rounded-md text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 transition'">
              ☽
            </button>
            <button (click)="setTheme('system')"
                    [class]="themeService.theme === 'system'
                      ? 'flex-1 text-xs py-1.5 rounded-md bg-white dark:bg-gray-800 text-slate-900 dark:text-white shadow-sm font-medium transition'
                      : 'flex-1 text-xs py-1.5 rounded-md text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 transition'">
              ◐
            </button>
          </div>

          <div class="text-xs text-slate-500 dark:text-gray-500 truncate">{{ userName() }}</div>
          <button (click)="auth.logout()"
                  class="text-xs text-slate-400 dark:text-gray-600 hover:text-slate-900 dark:hover:text-white mt-1 transition">
            Abmelden
          </button>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="flex-1 overflow-hidden">
        <router-outlet />
      </main>
    </div>
  `,
})
export class AdminLayoutComponent {
  auth = inject(AuthService)
  themeService = inject(ThemeServiceService)

  userName = computed(() => {
    const u = this.auth.user()
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.loginname : ''
  })

  navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: '◫' },
    { path: '/users', label: 'Benutzer', icon: '◉' },
    { path: '/location', label: 'Standort', icon: '⊡' },
    { path: '/product-groups', label: 'Produktgruppen', icon: '▣' },
    { path: '/products', label: 'Produkte', icon: '▤' },
    { path: '/printers', label: 'Drucker', icon: '⎙' },
  ]

  setTheme(theme: string) {
    this.themeService.setTheme(theme)
  }
}
