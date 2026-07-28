import { ChangeDetectionStrategy, Component, inject, computed, effect, signal } from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { Title } from '@angular/platform-browser'
import { TranslateModule } from '@ngx-translate/core'
import { AuthService } from '../core/auth.service'
import { ApiService } from '../core/api.service'
import { SyncProblemCountService } from '../core/sync-problem-count.service'
import { DeviceStatusService } from '../core/device-status.service'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { LocationStateService } from '../core/location-state.service'
import { LanguagePickerComponent } from '../shared/language-picker'

/**
 * Logische Gruppe in der Sidebar. Die Ueberschrift ist ein i18n-Key
 * (`NAV.GROUP_*`) und erscheint nur im ausgeklappten Zustand; eingeklappt
 * (w-16) ersetzt sie eine Trennlinie, damit die Icon-Spalte nicht mit Text
 * bricht.
 *
 * Bewusst ohne `order`/`id`/Flag-Felder (anders als das Cloud-Pendant): hier
 * gibt es genau eine Nav-Definition, die Array-Reihenfolge IST die Reihenfolge,
 * und Feature-Flags haben auf der Edge keine Entsprechung.
 */
interface NavGroup {
  label: string
  items: NavItem[]
}

interface NavItem {
  path: string
  label: string
  icon: string
  /**
   * Service-Pfad fuer den neutralen grauen Count (z.B. Anzahl Produkte).
   * Wird via api.find(svc, { $limit: 0 }) geladen.
   */
  countService?: string
  /**
   * Spezial-Indikator fuer Problem-Counts (rote Badge wenn > 0). Aktuell
   * nur fuer Sync-Status — fasst rejected sync-outbox + offene
   * sync-conflicts zusammen. Wenn das in mehr Nav-Items gebraucht wird,
   * generischen `indicator: { kind, severity }` einbauen.
   */
  problemCountKey?: 'sync'
  /**
   * Verbindungs-Badge: zeigt „verbunden von gesamt" (online/total) aus dem
   * DeviceStatusService — gleiche neutrale Optik wie die count-Badges (keine
   * farbliche Hervorhebung). Nur fuer den Geraete-Menuepunkt gesetzt.
   */
  connectionBadge?: boolean
}

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslateModule, LanguagePickerComponent],
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
            <p class="text-[10px] text-slate-400 dark:text-gray-600 mt-1 uppercase tracking-widest">{{ 'NAV.ADMIN_PANEL' | translate }}</p>
          </div>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 p-3 overflow-y-auto">
          @for (group of navGroups; track group.label; let firstGroup = $first) {

          <!--
            Gruppen-Kopf. Ausgeklappt: Caps-Micro-Label. Eingeklappt (w-16)
            wuerde Text umbrechen oder abgeschnitten werden — stattdessen eine
            1px-Trennlinie, das minimalste eindeutige Signal fuer eine
            Gruppengrenze (reiner Abstand waere bei fuenf Gruppen mehrdeutig).
            Der Container hat in BEIDEN Zustaenden eine feste Hoehe, damit die
            Icon-Spalte beim Ein-/Ausklappen nicht vertikal springt. Die erste
            Gruppe bekommt keine Linie — darueber sitzt schon die Logo-Border.
          -->
          <div class="flex items-end overflow-hidden"
               [class.h-7]="sidebarOpen()"
               [class.h-0]="!sidebarOpen() && firstGroup"
               [class.h-4]="!sidebarOpen() && !firstGroup">
            @if (sidebarOpen()) {
              <span class="px-3 pb-1 text-[10px] font-medium uppercase tracking-widest
                           text-slate-400 dark:text-gray-600 whitespace-nowrap">
                {{ group.label | translate }}
              </span>
            } @else if (!firstGroup) {
              <div class="mx-2 mb-1.5 h-px w-full bg-slate-200 dark:bg-gray-800"></div>
            }
          </div>

          <div class="space-y-0.5">
          @for (item of group.items; track item.path) {
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
               [title]="sidebarOpen() ? '' : (item.label | translate)">
              <span class="shrink-0 flex items-center justify-center w-10 relative">
                <span class="material-symbols-outlined" style="font-size: 20px; line-height: 1">{{ item.icon }}</span>
                <!-- Problem-Indikator im eingeklappten Sidebar-Modus: kleiner
                     roter Dot oben rechts am Icon. Im aufgeklappten Modus
                     wird stattdessen die Zahl-Badge rechts neben dem Label
                     gezeigt (siehe unten). -->
                @if (item.problemCountKey && problemCounts()[item.problemCountKey] > 0 && !sidebarOpen()) {
                  <span class="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500"
                        [title]="problemCounts()[item.problemCountKey] + ' offene Probleme'"></span>
                }
              </span>
              <span class="overflow-hidden whitespace-nowrap text-sm pr-3 flex items-center
                           transition-[max-width,opacity,flex] duration-200"
                    [class.max-w-0]="!sidebarOpen()"
                    [class.flex-0]="!sidebarOpen()"
                    [class.flex-1]="sidebarOpen()"
                    [class.opacity-0]="!sidebarOpen()">
                <span>{{ item.label | translate }}</span>
                @if (item.problemCountKey && problemCounts()[item.problemCountKey] > 0) {
                  <span class="flex-1"></span>
                  <span class="text-[11px] leading-none tabular-nums font-medium
                               bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300
                               ring-1 ring-inset ring-red-600/20 dark:ring-red-500/30
                               px-1.5 py-0.5 rounded-full">
                    {{ problemCounts()[item.problemCountKey] }}
                  </span>
                } @else if (item.connectionBadge && deviceStatus.online() !== null) {
                  <span class="flex-1"></span>
                  <span class="text-[11px] leading-none tabular-nums text-slate-400 dark:text-gray-500">
                    {{ 'NAV.DEVICE_BADGE' | translate: { online: deviceStatus.online() ?? 0, total: deviceStatus.total() ?? 0 } }}
                  </span>
                } @else if (item.countService && counts()[item.countService] !== undefined) {
                  <span class="flex-1"></span>
                  <span class="text-[11px] leading-none tabular-nums text-slate-400 dark:text-gray-500">
                    {{ counts()[item.countService] }}
                  </span>
                }
              </span>
            </a>
          }
          </div>
          }
        </nav>

        <!-- Footer: Theme-Toggle + User -->
        <div class="shrink-0 border-t border-slate-200 dark:border-gray-800"
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
            <app-language-picker class="block mb-3" [expanded]="true" />
            <div class="text-xs text-slate-500 dark:text-gray-500 truncate">{{ userName() }}</div>
            <button (click)="auth.logout()"
                    class="text-xs text-slate-400 dark:text-gray-600 hover:text-slate-900 dark:hover:text-white mt-1 transition">
              {{ 'COMMON.LOGOUT' | translate }}
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
              <app-language-picker [expanded]="false" />
              <button (click)="auth.logout()" [title]="'COMMON.LOGOUT' | translate"
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
      <main class="flex-1 overflow-hidden flex flex-col">
        <!-- Cloud-Status-Banner liegt global in app.ts (priorisiert, ein Banner). -->
        <div class="flex-1 overflow-hidden">
          <router-outlet />
        </div>
      </main>
    </div>
  `,
})
export class AdminLayoutComponent {
  auth = inject(AuthService)
  private api = inject(ApiService)
  private syncProblemCount = inject(SyncProblemCountService)
  protected deviceStatus = inject(DeviceStatusService)
  themeService = inject(ThemeServiceService)
  locationState = inject(LocationStateService)
  private title = inject(Title)

  sidebarOpen = signal(true)

  userName = computed(() => {
    const u = this.auth.user()
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.loginname : ''
  })

  navGroups: NavGroup[] = [
    { label: 'NAV.GROUP_OPERATIONS', items: [
      { path: '/dashboard',      label: 'NAV.DASHBOARD',        icon: 'dashboard'    },
      { path: '/orders',         label: 'NAV.ORDERS',           icon: 'receipt_long', countService: 'orders' },
      { path: '/business-days',  label: 'NAV.BUSINESS_DAYS',    icon: 'event'        },
    ]},
    { label: 'NAV.GROUP_CATALOG', items: [
      { path: '/product-groups', label: 'NAV.PRODUCT_GROUPS',   icon: 'category',    countService: 'product-groups' },
      { path: '/products',       label: 'NAV.PRODUCTS',         icon: 'inventory_2', countService: 'products' },
    ]},
    { label: 'NAV.GROUP_LOCATION', items: [
      { path: '/location',       label: 'NAV.LOCATION',         icon: 'store'        },
      { path: '/opening-hours',  label: 'NAV.OPENING_HOURS',    icon: 'schedule'     },
      // Gleiches Icon wie die Tisch-Kacheln im POS-Bestelldialog.
      { path: '/tables',         label: 'NAV.TABLES',           icon: 'table_restaurant' },
      { path: '/pagers',         label: 'NAV.PAGERS',           icon: 'vibration'    },
    ]},
    { label: 'NAV.GROUP_HARDWARE', items: [
      { path: '/printers',       label: 'NAV.PRINTERS',         icon: 'print'        },
      { path: '/devices',        label: 'NAV.DEVICES',          icon: 'devices',     connectionBadge: true },
    ]},
    { label: 'NAV.GROUP_SYSTEM', items: [
      { path: '/users',          label: 'NAV.USERS',            icon: 'people',      countService: 'users' },
      { path: '/apikeys',        label: 'NAV.API_KEYS',         icon: 'key'          },
      { path: '/cloud',          label: 'NAV.CLOUD_CONNECTION', icon: 'cloud',       problemCountKey: 'sync' },
      { path: '/sync-status',    label: 'NAV.SYNC_STATUS',      icon: 'sync_problem', problemCountKey: 'sync' },
      { path: '/logs',           label: 'NAV.LOGS',             icon: 'description'  },
    ]},
  ]

  /**
   * Flache Sicht fuer `loadCounts()`. Bewusst abgeleitet statt parallel
   * gepflegt — ein zurueckgelassenes leeres `navItems` haette alle
   * Count-Badges still gekillt, ohne dass der Compiler etwas sagt.
   */
  private readonly allNavItems: NavItem[] = this.navGroups.flatMap(g => g.items)

  counts = signal<Record<string, number>>({})
  /**
   * Rote-Badge-Counter fuer Hauptnav-Items mit `problemCountKey`. Liest
   * aus dem geteilten `SyncProblemCountService` — Operator-UI ruft dort
   * `refresh()` nach jeder Aktion, damit der Badge sofort aktuell ist
   * statt erst auf den naechsten 60s-Poll-Tick zu warten.
   */
  problemCounts = computed<Record<string, number>>(() => ({
    sync: this.syncProblemCount.count(),
  }))

  constructor() {
    this.locationState.load()
    effect(() => {
      const name = this.locationState.locationName()
      this.title.setTitle(name ? `Panary — Hub (${name})` : 'Panary — Hub')
    })
    this.loadCounts()
    this.syncProblemCount.refresh()
    void this.deviceStatus.refresh()
    // 60s-Poll fuer Problem-Indikator (sync-status). Reicht fuer Operator-
    // Use-Case; ein lebenslang offener Tab sieht neue Probleme innerhalb
    // einer Minute. Kein Memory-Cleanup noetig — Sidebar lebt App-weit.
    // Sofortiges Refresh nach Operator-Aktionen passiert ueber die
    // SyncConflictsComponent, die nach jeder retry/discard/resolve-Aktion
    // refresh() auf demselben Service triggert.
    // Counts (inkl. heutiger Bestellungen) im selben 60s-Takt aktualisieren —
    // der Sidebar-Tab lebt App-weit, sonst bliebe der „heute"-Badge stale.
    setInterval(() => {
      this.syncProblemCount.refresh()
      void this.loadCounts()
      void this.deviceStatus.refresh()
    }, 60_000)
  }

  private async loadCounts() {
    // Bestellungen: nur HEUTE zählen (lokale Mitternacht), nicht alle Tage —
    // identische Filter-Semantik wie order-list `getTimeRangeFilter('today')`.
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const services = this.allNavItems.filter(i => i.countService).map(i => i.countService!)
    const results: Record<string, number> = {}
    await Promise.all(
      services.map(async svc => {
        try {
          const query: Record<string, unknown> =
            svc === 'orders' ? { $limit: 0, createdAt: { $gte: todayStart } } : { $limit: 0 }
          const res = await this.api.find(svc, query)
          results[svc] = res.total
        } catch {
          // Count nicht verfügbar — ignorieren
        }
      }),
    )
    this.counts.set(results)
  }

  // loadProblemCounts wurde in `SyncProblemCountService.refresh()`
  // ausgelagert — Operator-UI kann nach Aktionen direkt darauf zugreifen.

  setTheme(theme: string) {
    this.themeService.setTheme(theme)
  }

  cycleTheme() {
    const themes = ['light', 'dark', 'system']
    const next = themes[(themes.indexOf(this.themeService.theme) + 1) % themes.length]
    this.themeService.setTheme(next)
  }

}
