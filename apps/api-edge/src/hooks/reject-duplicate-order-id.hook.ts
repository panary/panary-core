import { Conflict } from '@feathersjs/errors'

import { AppError, AppErrorMessages } from '@panary/shared-common'

import type { HookContext, NextFunction } from '../declarations'

// Eine Bestellung mit schon vergebener `_id` früh ablehnen (panary/panary-core#1351).
//
// Der POS vergibt die ID beim Sofortbezahlen selbst und schickt sie nach einer Frist oder Trennung
// noch einmal: Ob die erste Bestellung angekommen ist, weiß er nicht. Ohne diesen Hook scheitert
// der zweite Versuch erst am Primärschlüssel, also nach `assignDailySequenceNumber`,
// `allocateFiscalCounter` und `signOrderTseStart`. Bei aktiver TSE blieben eine Lücke in der
// lückenlosen Fiskal-Vorgangsnummer und eine offene TSE-Transaktion zurück, und der POS bekäme
// den rohen SQLite-Fehler statt einer 409.
//
// Als Around-Hook läuft er vor allen before-Hooks. Der Merker `inFlight` deckt den Fall ab, dass
// der zweite Versuch eintrifft, während der erste noch in seiner Hook-Kette steckt: Die Zeile steht
// dann noch nicht in der Tabelle. Der Edge ist single-process, ein Prozess-Set genügt (wie
// `assign-daily-sequence-number.ts`).
//
// Sync-Apply (`fromSync`) ist ausgenommen: Dort kommt ein fertiger Stand der Cloud an, und dessen
// Behandlung entscheidet der Sync, nicht dieser Hook.

const inFlight = new Set<string>()

const isFromSync = (context: HookContext): boolean => Boolean((context.params as { fromSync?: boolean }).fromSync)

const clientOrderId = (context: HookContext): string | undefined => {
  const data = context.data as { _id?: unknown } | unknown[] | undefined
  if (!data || Array.isArray(data)) return undefined
  const id = (data as { _id?: unknown })._id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

const conflict = (orderId: string): Conflict =>
  new Conflict(AppErrorMessages[AppError.ORDER_ALREADY_EXISTS], { code: AppError.ORDER_ALREADY_EXISTS, orderId })

export const rejectDuplicateOrderId = async (context: HookContext, next: NextFunction): Promise<void> => {
  const orderId = clientOrderId(context)
  if (!orderId || isFromSync(context)) return next()

  // Synchron belegen, bevor irgendetwas awaitet: Zwei gleichzeitige Versuche sähen sonst beide ein leeres Set.
  if (inFlight.has(orderId)) throw conflict(orderId)
  inFlight.add(orderId)
  try {
    const found = (await context.service.find({
      query: { _id: orderId, $limit: 1, $select: ['_id'] },
      paginate: false,
      provider: undefined,
    })) as Array<{ _id: string }>
    if (Array.isArray(found) && found.length > 0) throw conflict(orderId)
    await next()
  } finally {
    inFlight.delete(orderId)
  }
}
