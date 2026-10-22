import { isOrderOpen, type Order } from '@panary/orders/domain'

/** Annahme bis zur Anbindung der Öffnungszeiten: der Tag beginnt um 8 Uhr. */
const ASSUMED_DAY_START_HOUR = 8

function orderTime(order: Order): number | null {
  const ts = order.recordingDate ?? order.createdAt ?? (order as { created_at?: string }).created_at ?? order.updatedAt
  if (!ts) return null
  const time = new Date(ts).getTime()
  return Number.isNaN(time) ? null : time
}

/** Bestellungen je Stunde seit Tagesbeginn, eine Nachkommastelle. */
export function ordersPerHour(orderCount: number, now: Date): string {
  const start = new Date(now)
  start.setHours(ASSUMED_DAY_START_HOUR, 0, 0, 0)
  const hoursOpen = Math.max(1, (now.getTime() - start.getTime()) / 3_600_000)
  return (orderCount / hoursOpen).toFixed(1)
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
