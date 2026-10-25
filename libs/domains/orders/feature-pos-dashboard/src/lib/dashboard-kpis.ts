import { isOrderOpen, type Order } from '@panary/orders/domain'

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
 * Anzeigefenster des Diagramms: die Öffnungszeit des Tages, aufgeweitet um Stunden mit Bestellungen
 * (Verkauf außerhalb der Zeit darf nicht verschwinden). Ohne Öffnungszeit gilt der Rückfall.
 */
export function chartWindow(
  opening: { open?: string; close?: string } | null,
  counts: readonly number[],
): OpeningWindow {
  const open = hourOf(opening?.open)
  const close = hourOf(opening?.close)
  let { startHour, endHour } = FALLBACK_OPENING_HOURS
  if (open !== null && close !== null && close > open) {
    startHour = open
    // Schließt es auf :00, ist die Stunde `close` selbst nicht mehr offen; auf :30 schon.
    endHour = opening?.close?.endsWith(':00') ? close : close + 1
  }
  counts.forEach((count, hour) => {
    if (count > 0) {
      startHour = Math.min(startHour, hour)
      endHour = Math.max(endHour, hour + 1)
    }
  })
  return { startHour, endHour }
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

/** Anzahl Bestellungen je Stunde des Tages (Index 0–23, Ortszeit). */
export function hourlyOrderCounts(orders: readonly Order[]): number[] {
  const counts = new Array<number>(24).fill(0)
  for (const order of orders) {
    const time = orderTime(order)
    if (time !== null) counts[new Date(time).getHours()]++
  }
  return counts
}
