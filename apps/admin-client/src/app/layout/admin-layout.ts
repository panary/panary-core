import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { AuthService } from '../core/auth.service'

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-black flex">
      <!-- Sidebar -->
      <aside class="w-60 bg-gray-950 border-r border-gray-800 flex flex-col">
        <!-- Logo -->
        <div class="p-5 border-b border-gray-800">
          <img src="assets/panary_logo_mono.svg" alt="Panary" class="h-6 opacity-60" />
          <p class="text-[10px] text-gray-600 mt-1 uppercase tracking-widest">Admin Panel</p>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 p-3 space-y-1">
          @for (item of navItems; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="bg-gray-800 text-white"
               class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400
                      hover:text-white hover:bg-gray-900 transition">
              <span class="text-base">{{ item.icon }}</span>
              {{ item.label }}
            </a>
          }
        </nav>

        <!-- User Info -->
        <div class="p-4 border-t border-gray-800">
          <div class="text-xs text-gray-500 truncate">{{ userName() }}</div>
          <button (click)="auth.logout()" class="text-xs text-gray-600 hover:text-white mt-1 transition">
            Abmelden
          </button>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="flex-1 overflow-y-auto">
        <router-outlet />
      </main>
    </div>
  `,
})
export class AdminLayoutComponent {
  auth = inject(AuthService)

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
  ]
}
