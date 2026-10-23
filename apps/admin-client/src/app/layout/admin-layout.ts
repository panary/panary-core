import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { Title } from '@angular/platform-browser'
import { TranslateModule } from '@ngx-translate/core'
import { AuthService } from '../core/auth.service'
import { ApiService } from '../core/api.service'
import { SyncProblemCountService } from '../core/sync-problem-count.service'
import { DeviceStatusService } from '../core/device-status.service'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { LocationStateService } from '../core/location-state.service'
import { PanaryLogoComponent } from '@panary/shared/ui-common'
import { AdminIconComponent } from '../shared/icon/icon'
import type { AdminIconName } from '../shared/icon/icons.generated'
import { LanguagePickerComponent } from '../shared/language-picker'
import { EdgeStatusBarComponent } from './edge-status-bar'

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
  icon: AdminIconName
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
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TranslateModule,
    LanguagePickerComponent,
    AdminIconComponent,
    EdgeStatusBarComponent,
    PanaryLogoComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closeMobileNav()' },
  template: `
    <!--
      L-Shell (core#836, Konzept 2.8): dunkle Kopfzeile mit Edge-Status über die ganze Breite,
      darunter die dunkle Navigation links und der helle Inhalt mit runder Ecke oben links.
    -->
    <div class="h-screen flex flex-col bg-shell text-ink">
      <header class="h-11 shrink-0 flex items-center gap-4 px-4 text-shell-ink">
        @if (isNarrow()) {
          <button
            #menuButton
            type="button"
            (click)="openMobileNav()"
            [attr.aria-label]="'NAV.OPEN_MENU' | translate"
            [attr.aria-expanded]="mobileNavOpen()"
            aria-controls="admin-sidebar"
            class="h-9 w-9 -ml-2 flex items-center justify-center rounded-control hover:bg-shell-hover"
          >
            <app-icon name="list" class="text-[22px]" />
          </button>
        }
        <a routerLink="/dashboard" class="flex items-center gap-2 mr-auto font-bold text-[15px]">
          <lib-panary-logo [size]="1.5" />
          <span class="text-xs font-medium text-shell-muted">{{ 'NAV.EDGE_ADMIN' | translate }}</span>
        </a>
        <!-- Unter md nicht gerendert statt versteckt: sonst pollt die Zeile weiter, ohne sichtbar zu sein. -->
        @if (!isNarrow()) {
          <app-edge-status-bar />
        }
      </header>

      <div class="flex-1 min-h-0 flex">
        <!--
          Unterhalb von md (768 px) ist die Seitenleiste ein Drawer ueber dem Inhalt (#684).
          Ab md bleibt sie stehen und laesst sich auf die Icon-Spalte einklappen.
        -->
        @if (isNarrow() && mobileNavOpen()) {
          <button
            type="button"
            tabindex="-1"
            (click)="closeMobileNav()"
            [attr.aria-label]="'COMMON.CLOSE' | translate"
            class="fixed inset-0 z-40 bg-[var(--scrim)] cursor-default"
          ></button>
        }

        <aside
          #sidebar
          id="admin-sidebar"
          [attr.role]="isNarrow() && mobileNavOpen() ? 'dialog' : null"
          [attr.aria-modal]="isNarrow() && mobileNavOpen() ? 'true' : null"
          [attr.aria-label]="isNarrow() && mobileNavOpen() ? ('NAV.ADMIN_PANEL' | translate) : null"
          class="relative flex flex-col shrink-0 bg-shell-nav text-shell-ink transition-[width,translate] duration-200"
          [class.w-60]="!isNarrow() && sidebarOpen()"
          [class.w-16]="!isNarrow() && !sidebarOpen()"
          [class.fixed]="isNarrow()"
          [class.inset-y-0]="isNarrow()"
          [class.left-0]="isNarrow()"
          [class.z-50]="isNarrow()"
          [class.w-64]="isNarrow()"
          [class.shadow-2xl]="isNarrow()"
          [class.-translate-x-full]="isNarrow() && !mobileNavOpen()"
          [attr.aria-hidden]="isNarrow() && !mobileNavOpen() ? 'true' : null"
          [attr.inert]="isNarrow() && !mobileNavOpen() ? '' : null"
        >
          <!-- Einklapp-Schalter an der Kante zum Inhalt. Im Drawer gibt es ihn nicht. -->
          <button
            [class.hidden]="isNarrow()"
            (click)="sidebarOpen.set(!sidebarOpen())"
            [attr.aria-label]="(sidebarOpen() ? 'NAV.COLLAPSE' : 'NAV.EXPAND') | translate"
            class="absolute -right-3 top-3 z-20 h-6 w-6 rounded-full bg-shell-nav ring-1 ring-shell-hover
                   flex items-center justify-center text-shell-muted hover:text-shell-ink transition"
          >
            <app-icon [name]="sidebarOpen() ? 'caret-left' : 'caret-right'" class="text-[12px]" />
          </button>

          <nav class="flex-1 px-2.5 pb-3 overflow-y-auto">
            @for (group of navGroups; track group.label; let firstGroup = $first) {
              <!--
                Gruppen-Kopf: ausgeklappt Caps-Label, eingeklappt eine Trennlinie. Feste Hoehe in
                beiden Zustaenden, damit die Icon-Spalte beim Umschalten nicht springt.
              -->
              <div
                class="flex items-end overflow-hidden"
                [class.h-9]="expanded()"
                [class.h-3]="!expanded() && firstGroup"
                [class.h-5]="!expanded() && !firstGroup"
              >
                @if (expanded()) {
                  <span
                    class="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-shell-muted whitespace-nowrap"
                  >
                    {{ group.label | translate }}
                  </span>
                } @else if (!firstGroup) {
                  <div class="mx-2 mb-2 h-px w-full bg-shell-hover"></div>
                }
              </div>

              <div class="space-y-0.5">
                @for (item of group.items; track item.path) {
                  <!-- Icon in festem w-10 Rahmen: Position bleibt beim Ein-/Ausklappen gleich. -->
                  <a
                    [routerLink]="item.path"
                    (click)="closeMobileNav()"
                    routerLinkActive="bg-shell-active !text-shell-active-ink [&_app-icon]:text-action"
                    class="group flex items-center py-1.5 rounded-control text-shell-ink hover:bg-shell-hover focus-visible:outline-2 focus-visible:outline-action
                           transition-colors overflow-hidden"
                    [title]="expanded() ? '' : (item.label | translate)"
                  >
                    <span class="shrink-0 flex items-center justify-center w-10 relative text-shell-muted">
                      <app-icon [name]="item.icon" class="text-[18px]" />
                      <!-- Eingeklappt: roter Punkt statt Zahl fuer offene Probleme. -->
                      @if (item.problemCountKey && problemCounts()[item.problemCountKey] > 0 && !expanded()) {
                        <span
                          class="absolute top-0 right-1.5 w-2 h-2 rounded-full bg-danger"
                          [title]="problemCounts()[item.problemCountKey] + ' offene Probleme'"
                        ></span>
                      }
                    </span>
                    <span
                      class="overflow-hidden whitespace-nowrap text-sm pr-2.5 flex items-center
                             transition-[max-width,opacity,flex] duration-200"
                      [class.max-w-0]="!expanded()"
                      [class.flex-0]="!expanded()"
                      [class.flex-1]="expanded()"
                      [class.opacity-0]="!expanded()"
                    >
                      <span>{{ item.label | translate }}</span>
                      @if (item.problemCountKey && problemCounts()[item.problemCountKey] > 0) {
                        <span class="flex-1"></span>
                        <span
                          class="text-[11px] leading-none tabular-nums font-semibold bg-danger text-white px-1.5 py-0.5 rounded-pill"
                        >
                          {{ problemCounts()[item.problemCountKey] }}
                        </span>
                      } @else if (item.connectionBadge && deviceStatus.online() !== null) {
                        <span class="flex-1"></span>
                        <span class="text-xs leading-none tabular-nums text-shell-muted">
                          {{
                            'NAV.DEVICE_BADGE'
                              | translate: { online: deviceStatus.online() ?? 0, total: deviceStatus.total() ?? 0 }
                          }}
                        </span>
                      } @else if (item.countService && counts()[item.countService] !== undefined) {
                        <span class="flex-1"></span>
                        <span class="text-xs leading-none tabular-nums text-shell-muted">
                          {{ counts()[item.countService] }}
                        </span>
                      }
                    </span>
                  </a>
                }
              </div>
            }
          </nav>

          <!-- Fuss: Theme, Sprache, Benutzer, Abmelden -->
          <div class="shrink-0 border-t border-shell-hover p-3">
            @if (expanded()) {
              <div class="flex items-center gap-1 mb-3 bg-shell-hover rounded-control p-1">
                @for (option of themeOptions; track option.value) {
                  <button
                    type="button"
                    (click)="setTheme(option.value)"
                    [attr.aria-pressed]="themeService.theme === option.value"
                    [class]="
                      themeService.theme === option.value
                        ? 'flex-1 text-xs py-1.5 rounded-md bg-shell-active text-shell-ink font-medium transition'
                        : 'flex-1 text-xs py-1.5 rounded-md text-shell-muted hover:text-shell-ink transition'
                    "
                  >
                    {{ option.glyph }}
                  </button>
                }
              </div>
              <app-language-picker class="block mb-3" [expanded]="true" />
              <div class="flex items-center gap-2">
                <span class="flex-1 text-xs text-shell-muted truncate">{{ userName() }}</span>
                <button
                  type="button"
                  (click)="auth.logout()"
                  [title]="'COMMON.LOGOUT' | translate"
                  class="flex items-center gap-1 text-xs text-shell-muted hover:text-shell-ink transition"
                >
                  <app-icon name="sign-out" class="text-[16px]" />
                  {{ 'COMMON.LOGOUT' | translate }}
                </button>
              </div>
            } @else {
              <div class="flex flex-col items-center gap-3">
                <button
                  type="button"
                  (click)="cycleTheme()"
                  [title]="'Theme: ' + themeService.theme"
                  class="text-base leading-none text-shell-muted hover:text-shell-ink transition"
                >
                  {{ themeGlyph() }}
                </button>
                <app-language-picker [expanded]="false" />
                <button
                  type="button"
                  (click)="auth.logout()"
                  [title]="'COMMON.LOGOUT' | translate"
                  [attr.aria-label]="'COMMON.LOGOUT' | translate"
                  class="flex items-center justify-center text-shell-muted hover:text-shell-ink transition"
                >
                  <app-icon name="sign-out" class="text-[18px]" />
                </button>
              </div>
            }
          </div>
        </aside>

        <main
          class="flex-1 min-w-0 overflow-hidden flex flex-col bg-surface-bg md:rounded-tl-card"
          [attr.inert]="isNarrow() && mobileNavOpen() ? '' : null"
        >
          <!-- Cloud-Status-Banner liegt global in app.ts (priorisiert, ein Banner). -->
          <div class="flex-1 overflow-hidden">
            <router-outlet />
          </div>
        </main>
      </div>
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

  // Schwelle wie Tailwind `md`. Ohne matchMedia (Tests, alte Umgebungen) gilt die Desktop-Ansicht.
  private readonly narrowQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 767.98px)')
      : null
  readonly isNarrow = signal(this.narrowQuery?.matches ?? false)
  readonly mobileNavOpen = signal(false)
  /** Beschriftung sichtbar: im Drawer immer, sonst nach dem Einklapp-Schalter. */
  readonly expanded = computed(() => this.isNarrow() || this.sidebarOpen())

  userName = computed(() => {
    const u = this.auth.user()
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.loginname : ''
  })

  navGroups: NavGroup[] = [
    {
      label: 'NAV.GROUP_OPERATIONS',
      items: [
        { path: '/dashboard', label: 'NAV.DASHBOARD', icon: 'squares-four' },
        { path: '/orders', label: 'NAV.ORDERS', icon: 'receipt', countService: 'orders' },
        { path: '/business-days', label: 'NAV.BUSINESS_DAYS', icon: 'calendar-dots' },
      ],
    },
    {
      label: 'NAV.GROUP_CATALOG',
      items: [
        { path: '/product-groups', label: 'NAV.PRODUCT_GROUPS', icon: 'stack', countService: 'product-groups' },
        { path: '/products', label: 'NAV.PRODUCTS', icon: 'package', countService: 'products' },
      ],
    },
    {
      label: 'NAV.GROUP_LOCATION',
      items: [
        { path: '/location', label: 'NAV.LOCATION', icon: 'storefront' },
        { path: '/opening-hours', label: 'NAV.OPENING_HOURS', icon: 'clock' },
        // Gleiches Icon wie die Tisch-Kacheln im POS-Bestelldialog.
        { path: '/tables', label: 'NAV.TABLES', icon: 'table' },
        { path: '/pagers', label: 'NAV.PAGERS', icon: 'vibrate' },
      ],
    },
    {
      label: 'NAV.GROUP_HARDWARE',
      items: [
        { path: '/printers', label: 'NAV.PRINTERS', icon: 'printer' },
        { path: '/devices', label: 'NAV.DEVICES', icon: 'devices', connectionBadge: true },
      ],
    },
    {
      label: 'NAV.GROUP_SYSTEM',
      items: [
        { path: '/users', label: 'NAV.USERS', icon: 'users', countService: 'users' },
        { path: '/apikeys', label: 'NAV.API_KEYS', icon: 'key' },
        { path: '/cloud', label: 'NAV.CLOUD_CONNECTION', icon: 'cloud', problemCountKey: 'sync' },
        { path: '/sync-status', label: 'NAV.SYNC_STATUS', icon: 'cloud-warning', problemCountKey: 'sync' },
        { path: '/logs', label: 'NAV.LOGS', icon: 'file-text' },
      ],
    },
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
    if (this.narrowQuery) {
      const query = this.narrowQuery
      const onChange = (event: MediaQueryListEvent) => {
        this.isNarrow.set(event.matches)
        // Ein offener Drawer darf nicht als Zustand in die breite Ansicht mitwandern.
        if (!event.matches) this.mobileNavOpen.set(false)
      }
      query.addEventListener('change', onChange)
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange))
    }
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

  private readonly injector = inject(Injector)
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton')
  private readonly sidebar = viewChild<ElementRef<HTMLElement>>('sidebar')

  /**
   * Fokus wandert in den Drawer und beim Schliessen zurueck auf den Menue-Knopf
   * (Review #684). Erst nach dem Rendern: Vorher ist der Drawer noch `inert` bzw.
   * beim Schliessen `main`, und ein Fokus dorthin liefe ins Leere.
   */
  openMobileNav() {
    this.mobileNavOpen.set(true)
    afterNextRender(() => this.sidebar()?.nativeElement.querySelector<HTMLElement>('nav a')?.focus(), {
      injector: this.injector,
    })
  }

  closeMobileNav() {
    // Escape ist auf `document` gebunden und feuert auch ohne offenen Drawer —
    // dann darf der Fokus nicht auf den Menue-Knopf springen.
    if (!this.mobileNavOpen()) return
    this.mobileNavOpen.set(false)
    afterNextRender(() => this.menuButton()?.nativeElement.focus(), { injector: this.injector })
  }

  readonly themeOptions = [
    { value: 'light', glyph: '☀' },
    { value: 'dark', glyph: '☽' },
    { value: 'system', glyph: '◐' },
  ] as const

  protected themeGlyph(): string {
    return this.themeOptions.find(o => o.value === this.themeService.theme)?.glyph ?? '◐'
  }

  setTheme(theme: string) {
    this.themeService.setTheme(theme)
  }

  cycleTheme() {
    const themes = ['light', 'dark', 'system']
    const next = themes[(themes.indexOf(this.themeService.theme) + 1) % themes.length]
    this.themeService.setTheme(next)
  }
}
