import { isOrderOpen, type Order } from '@panary/orders/domain'
import {
  closedDayStatus,
  getOpeningHoursForDate,
  type ClosedDayLocation,
  type LocationScopedHourException,
} from '@panary/locations/domain'

/** Ohne gepflegte Öffnungszeit: Annahme 8 bis 20 Uhr (letzte Balkenstunde 19). */
export const FALLBACK_OPENING_HOURS: OpeningWindow = { startHour: 8, endHour: 20 }

/** Erste Stunde und Stunde des Schließens; angezeigt werden die Stunden von `startHour` bis `endHour - 1`. */
export interface OpeningWindow {
  startHour: number
  endHour: number
}

/** Stunde aus „HH:mm". */
function hourOf(time: string | undefined): number | null {
  const hour = Number.parseInt(time?.split(':')[0] ?? '', 10)
  return Number.isNaN(hour) ? null : hour
}

/**
 * Was die Startseite über den heutigen Tag weiß (core#1132). Nur `open` trägt eine Uhrzeit — „geschlossen"
 * und „nicht gepflegt" sahen vorher beide wie „08–20" aus.
 */
export type TodaysOpening = { kind: 'open'; open: string; close: string } | { kind: 'closed' } | { kind: 'unset' }

/**
 * Heutige Öffnungszeit der Filiale. Das Urteil geschlossen/offen/unbekannt fällt `closedDayStatus` (core#1133),
 * damit die Startseite dasselbe sagt wie das Order-Gate der Edge. Offen ohne lesbare Uhrzeit (Ausnahme ohne
 * Zeiten) zählt als nicht gepflegt.
 */
export function todaysOpening(
  location: ClosedDayLocation | null | undefined,
  exceptions: readonly LocationScopedHourException[],
  now: Date,
): TodaysOpening {
  const status = closedDayStatus(location, exceptions, now)
  if (status.state === 'closed') return { kind: 'closed' }
  if (status.state === 'unknown') return { kind: 'unset' }
  // Ortskalender-Datum als lokales Date: `getOpeningHoursForDate` liest Wochentag und Datum in Gerätezeit.
  const [year, month, day] = status.date.split('-').map(Number)
  const own = exceptions.filter(e => !location?._id || !e.locationId || e.locationId === location._id)
  const hours = getOpeningHoursForDate(
    new Date(year, month - 1, day),
    location?.settings?.openingHoursSettings?.regular ?? [],
    own,
  )
  if (hourOf(hours.open) === null || hourOf(hours.close) === null) return { kind: 'unset' }
  return { kind: 'open', open: hours.open as string, close: hours.close as string }
}

/** Anzeigefenster samt Beschriftungsart: `extended`, wenn Bestellungen außerhalb der Öffnungszeit liegen. */
export interface ChartWindow extends OpeningWindow {
  kind: TodaysOpening['kind']
  /** Öffnungszeit als „09–18" — nur bei `kind: 'open'`, unabhängig von der Aufweitung. */
  openingLabel: string | null
  extended: boolean
  hasOrders: boolean
}

const pad = (hour: number) => String(hour).padStart(2, '0')

/**
 * Anzeigefenster des Diagramms: die Öffnungszeit des Tages, aufgeweitet um Stunden mit Bestellungen
 * (Verkauf außerhalb der Zeit darf nicht verschwinden). Geschlossen oder ohne Öffnungszeit nutzt die
 * Achse den Rückfall — die Beschriftung nennt dann aber keine Uhrzeit (core#1132).
 */
export function chartWindow(opening: TodaysOpening, counts: readonly number[]): ChartWindow {
  let { startHour, endHour } = FALLBACK_OPENING_HOURS
  let openingLabel: string | null = null
  if (opening.kind === 'open') {
    const open = hourOf(opening.open) as number
    const close = hourOf(opening.close) as number
    if (close > open) {
      startHour = open
      // Schließt es auf :00, ist die Stunde `close` selbst nicht mehr offen; auf :30 schon.
      endHour = opening.close.endsWith(':00') ? close : close + 1
      openingLabel = `${pad(startHour)}–${pad(endHour)}`
    }
  }
  const openStart = startHour
  const openEnd = endHour
  let hasOrders = false
  counts.forEach((count, hour) => {
    if (count > 0) {
      hasOrders = true
      startHour = Math.min(startHour, hour)
      endHour = Math.max(endHour, hour + 1)
    }
  })
  // Eine Öffnungszeit über Mitternacht (close <= open) ist nicht darstellbar: Achse wie Rückfall, Label ohne Zeit.
  const kind = opening.kind === 'open' && openingLabel === null ? 'unset' : opening.kind
  const extended = kind === 'open' && (startHour < openStart || endHour > openEnd)
  return { startHour, endHour, kind, openingLabel, extended, hasOrders }
}

function orderTime(order: Order): number | null {
  const ts = order.recordingDate ?? order.createdAt ?? (order as { created_at?: string }).created_at ?? order.updatedAt
  if (!ts) return null
  const time = new Date(ts).getTime()
  return Number.isNaN(time) ? null : time
}

/** Bestellungen je Stunde seit Öffnung, als Zahl (Formatieren ist Sache der Anzeige, de-DE). */
export function ordersPerHour(orderCount: number, now: Date, startHour = FALLBACK_OPENING_HOURS.startHour): number {
  const start = new Date(now)
  start.setHours(startHour, 0, 0, 0)
  const hoursOpen = Math.max(1, (now.getTime() - start.getTime()) / 3_600_000)
  return orderCount / hoursOpen
}

/** Kurzfassung einer Vorbestellung für die Spalte „Als Nächstes abholen": „2× Brötchen, Torte". */
export function preOrderSummary(lineItems: readonly { name?: string; amount?: number }[] | undefined): string {
  if (!lineItems?.length) return ''
  const [first, ...rest] = lineItems
  const head = `${first.amount && first.amount > 1 ? `${first.amount}× ` : ''}${first.name ?? ''}`.trim()
  return rest.length ? `${head} +${rest.length}` : head
}

/**
 * Mittlere Wartezeit der offenen Bestellungen in Minuten. Nicht abgeholte (`unclaimed`) warten
 * nicht mehr — sie trieben den Schnitt sonst endlos hoch (#589).
 */
export function averageWaitingMinutes(orders: readonly Order[], now: Date): number {
  const waiting = orders
    .filter(order => isOrderOpen(order.status))
    .map(orderTime)
    .filter((time): time is number => time !== null)
  if (waiting.length === 0) return 0
  const totalMs = waiting.reduce((sum, time) => sum + (now.getTime() - time), 0)
  return Math.round(totalMs / waiting.length / 60_000)
}

/**
 * Anzahl Bestellungen je Stunde des heutigen Kalendertags (Index 0–23, Ortszeit). Bestellungen anderer Tage
 * zählen nicht: Ein über Mitternacht offener Geschäftstag brachte sonst die Abendbestellungen von gestern in die
 * Stunden von heute und weitete die Achse bis 24 Uhr (core#1132).
 */
export function hourlyOrderCounts(orders: readonly Order[], now: Date): number[] {
  const counts = new Array<number>(24).fill(0)
  for (const order of orders) {
    const time = orderTime(order)
    if (time === null) continue
    const date = new Date(time)
    if (date.toDateString() === now.toDateString()) counts[date.getHours()]++
  }
  return counts
}
