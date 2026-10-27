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
  /**
   * Fragt die Ruhetag-Freigabe an, wenn der Server `BD_6010` meldet (panary/panary-core#1133) — der Fehler
   * trägt Datum und Ruhetag-Regel für den Dialog. `true` = freigegeben, der Abschluss wird wiederholt.
   * Ohne Rückfrage bleibt `BD_6010` ein gewöhnlicher Fehler.
   */
  requestClosedDayApproval?: (error: unknown) => Promise<boolean>
}

/**
 * `paid` — bezahlt und abgeschlossen. `cash-session-declined` — die Freigabe kam nicht zustande.
 * `closed-day-declined` — am Ruhetag wurde nicht freigegeben.
 * `failed` — der Server hat abgelehnt (die Fehler-Notification kommt schon aus `handleError`). Nur `BD_6004` und
 * `BD_6010` beim ersten Auftreten bleiben still, weil der jeweilige Freigabe-Dialog die Lage erklärt.
 */
export type PayCashResult = 'paid' | 'cash-session-declined' | 'closed-day-declined' | 'failed'

/** Erkennt `LOCATION_CLOSED_TODAY` (AppError BD_6010) aus dem Ruhetag-Gate der Edge. */
export const isLocationClosedToday = (err: unknown): boolean => {
  const e = err as { code?: unknown; data?: { code?: unknown } } | undefined
  return e?.data?.code === 'BD_6010' || e?.code === 'BD_6010'
}

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
    // Höchstens je eine Rückfrage: Ruhetag (das Gate läuft am Server zuerst) und Kasse. Jede wird
    // beim ersten Auftreten still erwartet — ohne Opt-out stand die rohe 400-Meldung über dem
    // Freigabe-Dialog (core#1091). Danach meldet die Wiederholung wieder alles.
    let askedCashSession = false
    let askedClosedDay = !input.requestClosedDayApproval
    for (;;) {
      // Stand dieses Versuchs festhalten — die Rückfrage danach ändert die Flags.
      const expectCashSession = !askedCashSession
      const expectClosedDay = !askedClosedDay
      const expected = (err: unknown): boolean =>
        (expectCashSession && isCashSessionRequired(err)) || (expectClosedDay && isLocationClosedToday(err))
      const params = expectCashSession || expectClosedDay ? { isExpectedError: expected } : undefined
      try {
        await this.#orders.patch(input.orderId, payload, params)
        return 'paid'
      } catch (err) {
        if (!expected(err)) return 'failed'
        if (isLocationClosedToday(err)) {
          askedClosedDay = true
          if (!(await input.requestClosedDayApproval?.(err))) return 'closed-day-declined'
        } else {
          askedCashSession = true
          if (!(await input.requestCashSession(input.cashierId))) return 'cash-session-declined'
        }
      }
    }
  }
}
