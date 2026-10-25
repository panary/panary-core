import type { IconName } from '@panary/shared/ui-common'

/**
 * Navigation des POS: eine Quelle für Rail, „Mehr"-Menü und deren Sichtbarkeitsregeln (core#832).
 *
 * Die Regeln stammen unverändert aus den Schnellzugriffs-Kacheln des Dashboards (`quickActions`,
 * bis core#832). „Ausgeblendet" und „gesperrt" bleiben getrennt wie dort: `condition`,
 * `hideInStandalone` und `hideWhenCloudPaired` blenden aus, `requiresOnline` und `requiresBooking`
 * sperren mit Hinweis. Die Sperren sind Bedienkomfort, keine Rechteprüfung — Server, Guards und
 * PIN-Freigaben entscheiden weiter selbst (Konzept §3, `docs/domains/pos-navigation.md`).
 */

/** Zustand des Geräts, aus dem die Regeln lesen. */
export interface PosNavContext {
  readonly standalone: boolean
  /** Edge mit der Cloud gekoppelt (`cloudPairingStatus === 'connected'`). */
  readonly cloudPaired: boolean
  readonly businessDayOpen: boolean
  readonly offline: boolean
  /** Mandant in der Cloud gesperrt (`TENANT_SUSPENDED`). */
  readonly bookingSuspended: boolean
}

/** Aktionen, die einen Dialog öffnen statt einer Route. */
export type PosNavAction = 'write-off' | 'open-business-day' | 'close-business-day' | 'cash-drawer'

export type PosNavTarget =
  | { readonly kind: 'route'; readonly path: string; readonly queryParams?: Readonly<Record<string, string>> }
  | { readonly kind: 'action'; readonly action: PosNavAction }

export interface PosNavEntry {
  readonly id: string
  /** Übersetzungsschlüssel. */
  readonly label: string
  readonly icon: IconName
  readonly target: PosNavTarget
  /** Braucht eine Server-Verbindung; offline gesperrt mit Hinweis. */
  readonly requiresOnline?: boolean
  /** Bucht in der Cloud; bei Mandantensperre gesperrt (core#489). */
  readonly requiresBooking?: boolean
  readonly hideInStandalone?: boolean
  /**
   * Ausgeblendet, sobald die Edge gekoppelt ist: Eröffnung und Tagesabschluss laufen dann im
   * Cloud-Admin. Zusammen mit `hideInStandalone` sind diese Einträge damit nur im Cloud-Modus
   * ohne aktive Kopplung sichtbar — so gewollt (core#838).
   */
  readonly hideWhenCloudPaired?: boolean
  /** Weitere Sichtbarkeitsbedingung; ohne sie immer sichtbar. */
  readonly condition?: (ctx: PosNavContext) => boolean
}

export interface PosNavGroup {
  readonly id: string
  readonly label: string
  readonly entries: readonly PosNavEntry[]
}

/** Warum ein sichtbarer Eintrag gesperrt ist — als Übersetzungsschlüssel. */
export type PosNavBlock = 'CLOUD_STATUS.TENANT_SUSPENDED' | 'DASHBOARD.ACTION_OFFLINE_BLOCKED'

export interface PosNavItem {
  readonly entry: PosNavEntry
  readonly block: PosNavBlock | null
}

export interface PosNavItemGroup {
  readonly id: string
  readonly label: string
  readonly items: readonly PosNavItem[]
}

const route = (path: string, queryParams?: Record<string, string>): PosNavTarget => ({
  kind: 'route',
  path,
  queryParams,
})
const action = (name: PosNavAction): PosNavTarget => ({ kind: 'action', action: name })

export const KASSE_PATH = '/kasse'
export const OVERVIEW_PATH = '/dashboard'
export const OPEN_ORDERS_PATH = '/orders/active'
export const SETTINGS_PATH = '/settings'

/** Direkte Einträge der Rail, in Anzeigereihenfolge. Die Übersicht ist Startansicht und steht deshalb oben (core#907). */
export const RAIL_ENTRIES: readonly PosNavEntry[] = [
  { id: 'overview', label: 'POS_NAV.OVERVIEW', icon: 'squares-four', target: route(OVERVIEW_PATH) },
  // Offline nutzbar (Outbox); `kasseBookingGuard` sperrt die Route zusätzlich beim gesperrten Mandanten.
  {
    id: 'kasse',
    label: 'POS_NAV.KASSE',
    icon: 'shopping-cart-simple',
    target: route(KASSE_PATH),
    requiresBooking: true,
  },
  { id: 'open-orders', label: 'POS_NAV.OPEN', icon: 'receipt', target: route(OPEN_ORDERS_PATH) },
  // Offline nutzbar: Liste aus dem Cache, Anlegen über die Outbox; nur `convert` braucht online (im Service).
  { id: 'pre-orders', label: 'POS_NAV.PRE_ORDERS', icon: 'calendar-dots', target: route('/pre-orders') },
  {
    id: 'history',
    label: 'POS_NAV.HISTORY',
    icon: 'clock-counter-clockwise',
    target: route('/orders/history'),
    requiresOnline: true,
  },
]

/**
 * Einstellungen im „Mehr"-Menü: ein direkter Eintrag ohne Untermenü (core#971). Ohne `?section=` zeigt
 * die Seite „Allgemein"; die Abschnitte wechselt sie selbst in ihrer Seitenleiste. Immer sichtbar, offline nutzbar.
 */
export const SETTINGS_ENTRY: PosNavEntry = {
  id: 'settings',
  label: 'DASHBOARD.SETTINGS',
  icon: 'gear',
  target: route(SETTINGS_PATH),
}

/** Gruppen des „Mehr"-Menüs (Konzept §3). Die Einstellungen stehen darunter als eigener Eintrag (`SETTINGS_ENTRY`). */
export const MORE_GROUPS: readonly PosNavGroup[] = [
  {
    id: 'staff',
    label: 'POS_NAV.GROUP_STAFF',
    entries: [
      {
        id: 'working-times',
        label: 'DASHBOARD.WORKING_TIMES',
        icon: 'clock',
        target: route('/working-times'),
        requiresOnline: true,
      },
    ],
  },
  {
    id: 'goods',
    label: 'POS_NAV.GROUP_GOODS',
    entries: [
      {
        id: 'write-off',
        label: 'DASHBOARD.WRITE_OFF',
        icon: 'trash',
        target: action('write-off'),
        hideInStandalone: true,
        requiresOnline: true,
      },
    ],
  },
  {
    id: 'day',
    label: 'POS_NAV.GROUP_DAY',
    entries: [
      {
        id: 'open-business-day',
        label: 'DASHBOARD.OPEN_BUSINESS_DAY',
        icon: 'play-circle',
        target: action('open-business-day'),
        condition: ctx => !ctx.businessDayOpen,
        hideInStandalone: true,
        hideWhenCloudPaired: true,
        requiresOnline: true,
      },
      {
        id: 'close-business-day',
        label: 'DASHBOARD.CLOSE_BUSINESS_DAY',
        icon: 'seal-check',
        target: action('close-business-day'),
        condition: ctx => ctx.businessDayOpen,
        hideInStandalone: true,
        hideWhenCloudPaired: true,
        requiresOnline: true,
      },
      // Kassen sind ein Cloud-Feature: Standalone hat keinen Multi-Kassen-Tagesabschluss.
      {
        id: 'cash-drawer',
        label: 'POS_NAV.CASH_DRAWER',
        icon: 'cash-register',
        target: action('cash-drawer'),
        condition: ctx => ctx.businessDayOpen && ctx.cloudPaired,
        requiresOnline: true,
      },
    ],
  },
]

export function isNavEntryVisible(entry: PosNavEntry, ctx: PosNavContext): boolean {
  if (entry.hideInStandalone && ctx.standalone) return false
  if (entry.hideWhenCloudPaired && ctx.cloudPaired) return false
  return entry.condition ? entry.condition(ctx) : true
}

/** Die Mandantensperre geht vor „offline": Sie bleibt, wenn die Verbindung zurückkommt. */
export function navEntryBlock(entry: PosNavEntry, ctx: PosNavContext): PosNavBlock | null {
  if (entry.requiresBooking && ctx.bookingSuspended) return 'CLOUD_STATUS.TENANT_SUSPENDED'
  if (entry.requiresOnline && ctx.offline) return 'DASHBOARD.ACTION_OFFLINE_BLOCKED'
  return null
}

export function resolveNavItems(entries: readonly PosNavEntry[], ctx: PosNavContext): PosNavItem[] {
  return entries
    .filter(entry => isNavEntryVisible(entry, ctx))
    .map(entry => ({ entry, block: navEntryBlock(entry, ctx) }))
}

/** Gruppen ohne sichtbaren Eintrag entfallen samt Überschrift. */
export function resolveNavGroups(groups: readonly PosNavGroup[], ctx: PosNavContext): PosNavItemGroup[] {
  return groups
    .map(group => ({ id: group.id, label: group.label, items: resolveNavItems(group.entries, ctx) }))
    .filter(group => group.items.length > 0)
}

/** Pfad ohne Query und Fragment — Grundlage der Markierung des aktiven Eintrags. */
export function navPath(url: string): string {
  return url.split(/[?#]/, 1)[0]
}

export function isNavPathActive(entryPath: string, url: string): boolean {
  const path = navPath(url)
  return path === entryPath || path.startsWith(`${entryPath}/`)
}

/**
 * Stempel- und Pausen-Aktionen sind serverseitige Custom-Methods ohne Outbox: offline hingen sie
 * still. Begründung als Übersetzungsschlüssel, die Kontosperre vor „offline" (core#797).
 */
export function timeTrackingBlockedHintKey(suspended: boolean, offline: boolean): string | null {
  if (suspended) return 'CLOUD_STATUS.TENANT_SUSPENDED'
  if (offline) return 'DASHBOARD.TIME_TRACKING_OFFLINE_BLOCKED'
  return null
}

/** Stempel-Aktion der Rail (core#907). */
export type TimeClockAction = 'clock-in' | 'start-break' | 'end-break' | 'clock-out'

/**
 * Zustand der einen Stempeltaste der Rail (core#942): grau = ausgestempelt (Tipp = Kommen), mint =
 * eingestempelt (Tipp öffnet Pause/Gehen), amber = Pause (Tipp = Pause Ende).
 */
export type TimeClockState = 'out' | 'in' | 'break'

export function timeClockState(stampedIn: boolean, onBreak: boolean): TimeClockState {
  if (!stampedIn) return 'out'
  return onBreak ? 'break' : 'in'
}

/** Aktion eines Tipps auf die Stempeltaste; eingestempelt öffnet sie ein Menü statt zu stempeln. */
export function timeClockTapAction(state: TimeClockState): TimeClockAction | null {
  if (state === 'out') return 'clock-in'
  if (state === 'break') return 'end-break'
  return null
}

export type ScreenSide = 'left' | 'right'

/**
 * Die Rail sitzt dem Warenkorb gegenüber (Entscheidung Michael 2026-10-23, core#942): Rechtshänder
 * (Warenkorb links) haben die Rail rechts, Linkshänder (Warenkorb rechts) links — auf jeder Seite
 * mit Rail, nicht nur in der Kasse. Die Zuordnung der Bezeichnungen steht in [[HAND_OPTIONS]].
 */
export function railSide(cartSide: ScreenSide): ScreenSide {
  return cartSide === 'left' ? 'right' : 'left'
}

export interface HandOption {
  /** Gespeicherter Wert `posHandedness` = Seite des Warenkorbs. */
  readonly side: ScreenSide
  readonly label: string
  /** Das Hand-Icon zeigt eine rechte Hand; für Linkshänder wird es gespiegelt. */
  readonly mirrorIcon: boolean
}

/**
 * Bedienhand im Avatar-Menü (core#1063, Entscheidung Michael 2026-10-25): Rechtshänder haben den Warenkorb
 * links und die Rail rechts, Linkshänder umgekehrt. Getauscht wurde nur die Bezeichnung, nicht der gespeicherte
 * Wert — `left` heißt seitdem „Rechtshänder", und wer nie gewählt hat (Standard `left`), startet so.
 */
export const HAND_OPTIONS: readonly HandOption[] = [
  { side: 'left', label: 'POS_NAV.RIGHT_HANDED', mirrorIcon: false },
  { side: 'right', label: 'POS_NAV.LEFT_HANDED', mirrorIcon: true },
]
