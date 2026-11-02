import { BadRequest } from '@feathersjs/errors'
import { Mutex } from 'async-mutex'

import { isOrderOpen } from '@panary/orders/domain'
import { AppError, AppErrorMessages } from '@panary/shared-common'

import type { HookContext, NextFunction } from '../declarations'

// Die gebuchte Zahlung einer abgeschlossenen Bestellung ist fest
// (panary/panary-core#1300).
//
// Zwei Kassen kassieren dieselbe Bestellung kurz nacheinander (veraltete Liste,
// beide tippen „Abschliessen"). `validateOrderStatusTransition` laesst
// `completed → completed` durch, `restrictOrderToCashSession` kehrt bei einer
// schon kassierten Bestellung als idempotent zurueck — der zweite Patch ersetzte
// deshalb `payment` samt `performedBy`, und die Pro-Kassierer-Kassenabstimmung
// zaehlte den Betrag bei der falschen Lade. Ein Schutz im Client ist kein Riegel:
// Einzelkarte, Kasse und Outbox-Replay patchen ohne frisches Lesen.
//
// Gesperrt ist jede externe Aenderung von `payment`, sobald die Bestellung nicht
// mehr offen ist (COMPLETED, UNCLAIMED, ABORTED). Storno und Nichtabholung
// schicken kein `payment` und bleiben unberuehrt.
//
// Abgelehnt wird mit 400, nicht 409: Die Outbox des POS wertet 409 als „Server
// kennt den Datensatz schon" und quittiert still (`classifyOutboxError`). Eine
// offline kassierte Zahlung, die auf eine inzwischen von einer anderen Kasse
// abgeschlossene Bestellung trifft, waere damit spurlos verschwunden; mit 400
// landet sie als abgelehnter Eintrag beim Bediener.
//
// Dieselbe Zahlung noch einmal (verlorene Antwort, Wiederholung nach der
// Kassen-Freigabe) ist kein Konflikt: Gleich heisst „dieselben Transaktionen",
// gemessen an der `_id`, die der POS vergibt und die der Server nie umschreibt
// (`attributeOrderOperators` gleicht ueber genau diese ab). Dann faellt `payment`
// aus dem Patch, der gespeicherte Stand bleibt, der Aufruf geht durch.
//
// Interne Aufrufe (Sync-Apply, Worker) bleiben frei: Dort kommt ein fertiger
// Stand an, den der Edge nicht ablehnen darf.

const mutex = new Mutex()

interface PaymentLite {
  transactions?: Array<{ _id?: unknown }>
}

const carriesPayment = (context: HookContext): boolean => {
  const data = context.data as { payment?: unknown } | undefined
  return Boolean(context.params.provider) && context.id != null && !!data && 'payment' in data
}

const transactionIds = (payment: PaymentLite | null | undefined): string[] =>
  (payment?.transactions ?? []).map(t => (typeof t?._id === 'string' ? t._id : '')).sort()

const sameTransactions = (incoming: PaymentLite | null | undefined, stored: PaymentLite | null | undefined) => {
  const a = transactionIds(incoming)
  const b = transactionIds(stored)
  return a.length > 0 && !a.includes('') && a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * Around-Hook am `patch`: Pruefung und Schreiben eines Zahlungs-Patches laufen
 * hintereinander, nie verschraenkt. Ohne ihn lesen zwei gleichzeitige
 * Kassiervorgaenge beide „offen", bevor der erste gespeichert ist. Der Edge ist
 * single-process, ein Prozess-Mutex genuegt (wie `reject-second-open-cash-session`).
 * Nur externe Patches mit `payment` warten — alles andere laeuft ungebremst.
 */
export const serializeOrderPaymentPatch = async (context: HookContext, next: NextFunction): Promise<void> => {
  if (!carriesPayment(context)) return next()
  await mutex.runExclusive(() => next())
}

/**
 * Before-Hook am `patch`, direkt hinter `validateOrderStatusTransition` und vor
 * jeder Nebenwirkung (Bediener-Zurechnung, Kassen-Guard mit Auto-Open, TSE).
 * Wirft `400` mit `AppError.ORDER_ALREADY_SETTLED`.
 */
export const lockSettledOrderPayment = async (context: HookContext): Promise<HookContext> => {
  if (context.method !== 'patch' || !carriesPayment(context)) return context

  const data = context.data as { payment?: PaymentLite | null }
  const stored = (await context.service.get(context.id!, { provider: undefined } as never)) as {
    status?: string
    payment?: PaymentLite | null
  }
  if (isOrderOpen(stored?.status)) return context

  if (sameTransactions(data.payment, stored.payment)) {
    delete data.payment
    return context
  }

  throw new BadRequest(AppErrorMessages[AppError.ORDER_ALREADY_SETTLED], {
    code: AppError.ORDER_ALREADY_SETTLED,
    orderId: String(context.id),
    status: stored.status,
  })
}
