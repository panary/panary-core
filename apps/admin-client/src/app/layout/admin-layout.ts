import { ChangeDetectionStrategy, Component, inject, computed, effect, signal } from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { Title } from '@angular/platform-browser'
import { AuthService } from '../core/auth.service'
import { ThemeServiceService } from '@panary-core/shared/data-access-theme'
import { LocationStateService } from '../core/location-state.service'

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="h-screen bg-slate-50 dark:bg-black flex">

      <!-- Sidebar -->
      <aside class="flex flex-col shrink-0 bg-white dark:bg-gray-950
                    border-r border-slate-200 dark:border-gray-800 transition-[width] duration-200"
             [class.w-56]="sidebarOpen()"
             [class.w-16]="!sidebarOpen()">

        <!--
          Logo-Kopfzeile — feste Höhe.
          px-4 und gap-3 nur im ausgeklappten Zustand: so bleibt das Icon beim Zuklappen
          exakt zentriert (justify-center auf einen einzigen Flex-Item ohne Margin/Gap).
        -->
        <div class="relative h-[68px] shrink-0 border-b border-slate-200 dark:border-gray-800 flex items-center px-3">

          <!-- Toggle-Pill — dockt an der rechten Kante der Sidebar an -->
          <button (click)="sidebarOpen.set(!sidebarOpen())"
                  class="absolute left-full top-1/2 -translate-y-1/2 z-20
                         h-10 w-4 rounded-r-lg
                         bg-white dark:bg-gray-950
                         border-r border-t border-b border-slate-200 dark:border-gray-800
                         flex items-center justify-center
                         text-slate-400 dark:text-gray-500
                         hover:text-slate-900 dark:hover:text-white transition">
            <span class="material-symbols-outlined" style="font-size: 14px; line-height: 1">
              {{ sidebarOpen() ? 'chevron_left' : 'chevron_right' }}
            </span>
          </button>

          <!--
            Icon in festem w-10 Rahmen — identisch zum Nav-Icon-Muster.
            Position ändert sich NICHT zwischen auf- und zugeklappt.
          -->
          <span class="shrink-0 flex items-center justify-center w-10">
            <svg viewBox="0 0 34 44" class="h-7 w-auto fill-slate-900 dark:fill-white">
              <rect x="0" y="0" width="12" height="44" rx="2"/>
              <rect x="16" y="0" width="18" height="24" rx="2"/>
            </svg>
          </span>

          <!--
            Text bleibt immer im DOM — kein @if, kein DOM-Rebuild.
            max-w + opacity-Übergang verhindert Font-Rendering-Flash.
          -->
          <div class="min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-150"
               [class.max-w-0]="!sidebarOpen()"
               [class.max-w-xs]="sidebarOpen()"
               [class.opacity-0]="!sidebarOpen()">
            <p class="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-none">Panary</p>
            <p class="text-[10px] text-slate-400 dark:text-gray-600 mt-1 uppercase tracking-widest">Admin Panel</p>
          </div>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 p-3 space-y-0.5 overflow-y-auto">
          @for (item of navItems; track item.path) {
            <!--
              Icon in festem w-10 Rahmen (= nav-content-Breite bei w-16 Sidebar mit p-3).
              Die Icon-Position ändert sich NICHT zwischen auf- und zugeklappt — kein Sprung.
              Collapsed: w-10 füllt den gesamten 40px-Content-Bereich → Icon zentriert.
              Expanded: w-10 am linken Rand → Label schließt rechtsbündig an.
            -->
            <a [routerLink]="item.path"
               routerLinkActive="bg-slate-100 dark:bg-gray-800 text-slate-900 dark:text-white"
               class="flex items-center py-2 rounded-lg text-slate-500 dark:text-gray-400
                      hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-gray-900
                      transition-colors overflow-hidden"
               [title]="sidebarOpen() ? '' : item.label">
              <span class="shrink-0 flex items-center justify-center w-10">
                <span class="material-symbols-outlined" style="font-size: 20px; line-height: 1">{{ item.icon }}</span>
              </span>
              <span class="overflow-hidden whitespace-nowrap text-sm pr-3
                           transition-[max-width,opacity] duration-200"
                    [class.max-w-0]="!sidebarOpen()"
                    [class.max-w-xs]="sidebarOpen()"
                    [class.opacity-0]="!sidebarOpen()">
                {{ item.label }}
              </span>
            </a>
          }
        </nav>

        <!-- Footer: Theme-Toggle + User -->
        <div class="border-t border-slate-200 dark:border-gray-800"
             [class.p-4]="sidebarOpen()"
             [class.p-3]="!sidebarOpen()">

          @if (sidebarOpen()) {
            <!-- Ausgeklappt: 3-Schaltflächen-Reihe + Benutzername + Abmelden-Link -->
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

          } @else {
            <!-- Eingeklappt: Theme-Cycle-Icon + Logout-Icon, zentriert -->
            <div class="flex flex-col items-center gap-3">
              <button (click)="cycleTheme()"
                      [title]="'Theme: ' + themeService.theme"
                      class="text-base leading-none text-slate-500 dark:text-gray-400
                             hover:text-slate-900 dark:hover:text-white transition">
                {{ themeService.theme === 'light' ? '☀' : themeService.theme === 'dark' ? '☽' : '◐' }}
              </button>
              <button (click)="auth.logout()" title="Abmelden"
                      class="flex items-center justify-center
                             text-slate-400 dark:text-gray-600
                             hover:text-slate-900 dark:hover:text-white transition">
                <span class="material-symbols-outlined" style="font-size: 20px; line-height: 1">logout</span>
              </button>
            </div>
          }
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
  locationState = inject(LocationStateService)
  private title = inject(Title)

  sidebarOpen = signal(true)

  userName = computed(() => {
    const u = this.auth.user()
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.loginname : ''
  })

  constructor() {
    this.locationState.load()
    effect(() => {
      const name = this.locationState.locationName()
      this.title.setTitle(name ? `Panary | Hub (${name})` : 'Panary | Hub')
    })
  }

  navItems = [
    { path: '/dashboard',      label: 'Dashboard',      icon: 'dashboard'   },
    { path: '/users',          label: 'Benutzer',       icon: 'people'      },
    { path: '/location',       label: 'Standort',       icon: 'store'       },
    { path: '/product-groups', label: 'Produktgruppen', icon: 'category'    },
    { path: '/products',       label: 'Produkte',       icon: 'inventory_2' },
    { path: '/printers',       label: 'Drucker',        icon: 'print'       },
    { path: '/apikeys',        label: 'API-Schlüssel',  icon: 'key'         },
    { path: '/cloud',          label: 'Cloud-Kopplung', icon: 'cloud'       },
  ]

  setTheme(theme: string) {
    this.themeService.setTheme(theme)
  }

  cycleTheme() {
    const themes = ['light', 'dark', 'system']
    const next = themes[(themes.indexOf(this.themeService.theme) + 1) % themes.length]
    this.themeService.setTheme(next)
  }
}
