import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  HAND_OPTIONS,
  isNavPathActive,
  MORE_GROUPS,
  type PosNavContext,
  RAIL_ENTRIES,
  resolveNavGroups,
  resolveNavItems,
  SETTINGS_ENTRY,
  railSide,
  type ScreenSide,
  timeClockState,
  timeClockTapAction,
  timeTrackingBlockedHintKey,
} from './pos-navigation'

/** Gekoppelte Edge, online, Tag offen — der Normalbetrieb beim Testkunden. */
const PAIRED: PosNavContext = {
  standalone: false,
  cloudPaired: true,
  businessDayOpen: true,
  offline: false,
  bookingSuspended: false,
}

const ids = (ctx: PosNavContext): string[] =>
  resolveNavGroups(MORE_GROUPS, ctx).flatMap(group => group.items.map(item => item.entry.id))

const blockOf = (id: string, ctx: PosNavContext): string | null => {
  const item = [
    ...resolveNavItems(RAIL_ENTRIES, ctx),
    ...resolveNavGroups(MORE_GROUPS, ctx).flatMap(g => g.items),
  ].find(i => i.entry.id === id)
  if (!item) throw new Error(`${id} nicht sichtbar`)
  return item.block
}

describe('Rail', () => {
  it('zeigt die fünf direkten Einträge in jedem Zustand', () => {
    for (const ctx of [
      PAIRED,
      { ...PAIRED, offline: true },
      { ...PAIRED, bookingSuspended: true },
      { ...PAIRED, standalone: true, cloudPaired: false, businessDayOpen: false },
    ]) {
      expect(resolveNavItems(RAIL_ENTRIES, ctx).map(item => item.entry.id)).toEqual([
        'overview',
        'kasse',
        'open-orders',
        'pre-orders',
        'history',
      ])
    }
  })

  it('requiresBooking: Kasse ist bei Mandantensperre gesperrt, offline aber nutzbar', () => {
    expect(blockOf('kasse', PAIRED)).toBeNull()
    expect(blockOf('kasse', { ...PAIRED, offline: true })).toBeNull()
    expect(blockOf('kasse', { ...PAIRED, bookingSuspended: true })).toBe('CLOUD_STATUS.TENANT_SUSPENDED')
  })

  it('requiresOnline: Historie ist offline gesperrt, Offen/Vorbest./Übersicht nicht', () => {
    const offline = { ...PAIRED, offline: true }
    expect(blockOf('history', offline)).toBe('DASHBOARD.ACTION_OFFLINE_BLOCKED')
    expect(blockOf('history', PAIRED)).toBeNull()
    for (const id of ['open-orders', 'pre-orders', 'overview']) expect(blockOf(id, offline), id).toBeNull()
  })

  it('die Mandantensperre geht im Hinweis vor „offline"', () => {
    // Nur die Kasse trägt requiresBooking; die Kombination prüft die Reihenfolge an ihr.
    expect(blockOf('kasse', { ...PAIRED, offline: true, bookingSuspended: true })).toBe('CLOUD_STATUS.TENANT_SUSPENDED')
  })
})

describe('„Mehr"-Menü', () => {
  it('gekoppelt, Tag offen: Arbeitszeiten, Abschreiben, Kassenlade — kein Tag eröffnen/abschließen', () => {
    expect(ids(PAIRED)).toEqual(['working-times', 'write-off', 'cash-drawer'])
  })

  it('hideWhenCloudPaired: Tag eröffnen/abschließen erscheinen nur ohne aktive Kopplung', () => {
    const unpaired = { ...PAIRED, cloudPaired: false }
    expect(ids({ ...unpaired, businessDayOpen: false })).toContain('open-business-day')
    expect(ids(unpaired)).toContain('close-business-day')
    expect(ids({ ...PAIRED, businessDayOpen: false })).not.toContain('open-business-day')
  })

  it('condition: Tag eröffnen nur ohne offenen Tag, Tagesabschluss nur mit', () => {
    const unpaired = { ...PAIRED, cloudPaired: false }
    expect(ids({ ...unpaired, businessDayOpen: false })).not.toContain('close-business-day')
    expect(ids({ ...unpaired, businessDayOpen: true })).not.toContain('open-business-day')
  })

  it('condition: Kassenlade nur bei offenem Tag UND Kopplung', () => {
    expect(ids(PAIRED)).toContain('cash-drawer')
    expect(ids({ ...PAIRED, businessDayOpen: false })).not.toContain('cash-drawer')
    expect(ids({ ...PAIRED, cloudPaired: false })).not.toContain('cash-drawer')
  })

  it('hideInStandalone: Standalone zeigt nur Arbeitszeiten, die Gruppen Ware und Tag entfallen', () => {
    for (const businessDayOpen of [true, false]) {
      const standalone = { ...PAIRED, standalone: true, cloudPaired: false, businessDayOpen }
      expect(ids(standalone)).toEqual(['working-times'])
      expect(resolveNavGroups(MORE_GROUPS, standalone).map(group => group.id)).toEqual(['staff'])
    }
  })

  it('requiresOnline: offline sind Arbeitszeiten, Abschreiben und Kassenlade gesperrt, nicht ausgeblendet', () => {
    const offline = { ...PAIRED, offline: true }
    expect(ids(offline)).toEqual(['working-times', 'write-off', 'cash-drawer'])
    for (const id of ids(offline)) expect(blockOf(id, offline), id).toBe('DASHBOARD.ACTION_OFFLINE_BLOCKED')
  })

  it('Einstellungen: ein direkter Eintrag ohne Abschnitt, immer sichtbar und offline nutzbar', () => {
    const [item] = resolveNavItems([SETTINGS_ENTRY], { ...PAIRED, offline: true, bookingSuspended: true })
    expect(item.entry.target).toEqual({ kind: 'route', path: '/settings', queryParams: undefined })
    expect(item.block).toBeNull()
  })
})

describe('isNavPathActive', () => {
  it('trifft den Pfad und seine Unterpfade, nicht Nachbarn mit gleichem Präfix', () => {
    expect(isNavPathActive('/orders/active', '/orders/active')).toBe(true)
    expect(isNavPathActive('/settings', '/settings?section=printer')).toBe(true)
    expect(isNavPathActive('/kasse', '/kasse/x#y')).toBe(true)
    expect(isNavPathActive('/orders/active', '/orders/history')).toBe(false)
    expect(isNavPathActive('/kasse', '/kassenbuch')).toBe(false)
  })
})

describe('timeTrackingBlockedHintKey', () => {
  it('nennt die Kontosperre vor „offline" und gibt ohne Sperre null', () => {
    expect(timeTrackingBlockedHintKey(true, true)).toBe('CLOUD_STATUS.TENANT_SUSPENDED')
    expect(timeTrackingBlockedHintKey(true, false)).toBe('CLOUD_STATUS.TENANT_SUSPENDED')
    expect(timeTrackingBlockedHintKey(false, true)).toBe('DASHBOARD.TIME_TRACKING_OFFLINE_BLOCKED')
    expect(timeTrackingBlockedHintKey(false, false)).toBeNull()
  })
})

describe('Stempeltaste (core#942)', () => {
  it('Zustand: aus, eingestempelt, Pause', () => {
    expect(timeClockState(false, false)).toBe('out')
    expect(timeClockState(true, false)).toBe('in')
    expect(timeClockState(true, true)).toBe('break')
  })

  it('Tipp: aus → Kommen, Pause → Pause Ende, eingestempelt → kein Stempeln (Menü)', () => {
    expect(timeClockTapAction('out')).toBe('clock-in')
    expect(timeClockTapAction('break')).toBe('end-break')
    expect(timeClockTapAction('in')).toBeNull()
  })
})

describe('railSide (core#942)', () => {
  it('Rail sitzt dem Warenkorb gegenüber', () => {
    expect(railSide('left')).toBe('right')
    expect(railSide('right')).toBe('left')
  })
})

const readRepoFile = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const handLabels = (lang: string): Record<string, string> => {
  const { POS_NAV } = JSON.parse(readRepoFile(`../../../../../../../apps/pos-client/src/assets/i18n/${lang}.json`))
  return { 'POS_NAV.LEFT_HANDED': POS_NAV.LEFT_HANDED, 'POS_NAV.RIGHT_HANDED': POS_NAV.RIGHT_HANDED }
}

/** Seite des Warenkorbs in der Kasse, gelesen aus den Grid-Areas der Kasse — nicht aus einer Annahme im Test. */
const kasseCartSide = (hand: ScreenSide): ScreenSide => {
  const scss = readRepoFile(
    '../../../../../../domains/orders/feature-pos-order-dialog/src/lib/order-dialog.component.scss',
  )
  const block = hand === 'right' ? scss.slice(scss.indexOf("&[data-hand='right']")) : scss
  const row = /'(cart grid|grid cart)'/.exec(block)?.[1]
  if (!row) throw new Error(`Keine Warenkorb-Zeile in den Grid-Areas für data-hand=${hand}`)
  return row === 'cart grid' ? 'left' : 'right'
}

describe('Bedienhand im Avatar-Menü (core#1063)', () => {
  const layoutOf = (label: string) => {
    const option = HAND_OPTIONS.find(entry => entry.label === label)
    if (!option) throw new Error(`Keine Option ${label}`)
    return { cart: kasseCartSide(option.side), rail: railSide(option.side), mirrorIcon: option.mirrorIcon }
  }

  it('Rechtshänder: Warenkorb links, Rail rechts, Hand-Icon ungespiegelt', () => {
    expect(layoutOf('POS_NAV.RIGHT_HANDED')).toEqual({ cart: 'left', rail: 'right', mirrorIcon: false })
  })

  it('Linkshänder: Warenkorb rechts, Rail links, Hand-Icon gespiegelt', () => {
    expect(layoutOf('POS_NAV.LEFT_HANDED')).toEqual({ cart: 'right', rail: 'left', mirrorIcon: true })
  })

  it('der gespeicherte Wert bleibt die Seite des Warenkorbs — Bestandswerte kippen nicht', () => {
    expect(HAND_OPTIONS.map(option => option.side)).toEqual(['left', 'right'])
    expect(HAND_OPTIONS.map(option => kasseCartSide(option.side))).toEqual(['left', 'right'])
  })

  it.each(['de', 'en', 'tr'])('Beschriftung %s passt zur Hand', lang => {
    expect(handLabels(lang)).toEqual(
      {
        de: { 'POS_NAV.LEFT_HANDED': 'Linkshänder', 'POS_NAV.RIGHT_HANDED': 'Rechtshänder' },
        en: { 'POS_NAV.LEFT_HANDED': 'Left-handed', 'POS_NAV.RIGHT_HANDED': 'Right-handed' },
        tr: { 'POS_NAV.LEFT_HANDED': 'Solak', 'POS_NAV.RIGHT_HANDED': 'Sağ elini kullanan' },
      }[lang],
    )
  })
})
