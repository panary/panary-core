import { inject, Injectable } from '@angular/core'
import { uuidv7 } from 'uuidv7'
import { OrderStatus, PaymentState, TransactionMethod, type Payment } from '@panary/orders/domain'
import { OrderService } from './order.service'

export interface PayCashInput {
  orderId: string
  /** Summe in Euro — gleich der Anzeige an der Kasse. */
  total: number
  cashierId: string
  /**
   * Fragt die Kassen-Freigabe an, wenn der Server `BD_6004` meldet (keine offene Kasse des Kassierers).
   * `true` = Kasse wurde eröffnet, der Abschluss wird einmal wiederholt. Der Dialog liegt in einer
   * Feature-Lib — der Service kennt ihn nicht und bekommt nur die Rückfrage.
   */
  requestCashSession: (cashierId: string) => Promise<boolean>
}

/**
 * `paid` — bezahlt und abgeschlossen. `cash-session-declined` — die Freigabe kam nicht zustande.
 * `failed` — der Server hat abgelehnt (die Fehler-Notification kommt schon aus `handleError`). Nur `BD_6004` beim
 * ersten Versuch bleibt still, weil der Freigabe-Dialog die Lage erklärt.
 */
export type PayCashResult = 'paid' | 'cash-session-declined' | 'failed'

/** Erkennt den CASH_SESSION_REQUIRED-Fehler (AppError BD_6004) aus dem Guard. */
export const isCashSessionRequired = (err: unknown): boolean => {
  const e = err as { code?: unknown; data?: { code?: unknown } } | undefined
  return e?.data?.code === 'BD_6004' || e?.code === 'BD_6004'
}

/** Eine Bar-Transaktion über die ganze Summe; `performedBy` ist die Basis der Pro-Kassierer-Kassenabstimmung. */
export const buildCashPayment = (total: number, cashierId: string, now: Date = new Date()): Payment => ({
  state: PaymentState.PAID,
  totalAmount: total,
  tipAmount: 0,
  transactions: [
    {
      _id: uuidv7(),
      method: TransactionMethod.CASH,
      amount: total,
      currency: 'EUR',
      timestamp: now.toISOString(),
      performedBy: cashierId,
    },
  ],
})

/**
 * Bar kassieren — der Kern aus „Offene Bestellungen" (`finalizeOrder`), jetzt auch für die Bezahlansicht
 * der Kasse (core#831). Status und Payment gehen in einem Patch, kein zusätzlicher `complete()`-Aufruf.
 * Die Zahlung wird einmal gebaut und bei der Wiederholung nach der Freigabe unverändert gesendet.
 */
@Injectable({ providedIn: 'root' })
export class OrderCheckoutService {
  readonly #orders = inject(OrderService)

  async payCash(input: PayCashInput): Promise<PayCashResult> {
    const payload = {
      payment: buildCashPayment(input.total, input.cashierId),
      status: OrderStatus.COMPLETED,
    }
    try {
      // BD_6004 ist hier der erwartete Auslöser der Freigabe, kein Fehler: ohne Opt-out stand die rohe
      // 400-Meldung über dem Freigabe-Dialog (core#1091). Die Wiederholung unten meldet wieder alles.
      await this.#orders.patch(input.orderId, payload, { isExpectedError: isCashSessionRequired })
      return 'paid'
    } catch (err) {
      if (!isCashSessionRequired(err)) return 'failed'
    }

    if (!(await input.requestCashSession(input.cashierId))) return 'cash-session-declined'
    try {
      await this.#orders.patch(input.orderId, payload)
      return 'paid'
    } catch {
      return 'failed'
    }
  }
}
