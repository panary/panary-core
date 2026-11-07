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
// Als Around-Hook läuft er vor allen before-Hooks. Trifft die Wiederholung ein, während der erste
// Versuch noch in seiner Hook-Kette steckt, steht die Zeile noch nicht in der Tabelle. Dann wartet
// sie auf dessen Ausgang (`inFlight`): Ist die Bestellung danach gespeichert, kommt die 409, und
// der POS übernimmt sie. Ist der erste Versuch gescheitert, läuft die Wiederholung normal weiter.
// Eine sofortige 409 ließe den POS eine Bestellung übernehmen, die es womöglich nie gibt. Der Edge
// ist single-process, eine Prozess-Map genügt (wie `assign-daily-sequence-number.ts`).
//
// Sync-Apply (`fromSync`) ist ausgenommen: Dort kommt ein fertiger Stand der Cloud an, und dessen
// Behandlung entscheidet der Sync, nicht dieser Hook.

const inFlight = new Map<string, Promise<void>>()

const isFromSync = (context: HookContext): boolean => Boolean((context.params as { fromSync?: boolean }).fromSync)

const clientOrderId = (context: HookContext): string | undefined => {
  const data = context.data as { _id?: unknown } | unknown[] | undefined
  if (!data || Array.isArray(data)) return undefined
  const id = (data as { _id?: unknown })._id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

const exists = async (context: HookContext, orderId: string): Promise<boolean> => {
  const found = (await context.service.find({
    query: { _id: orderId, $limit: 1, $select: ['_id'] },
    paginate: false,
    provider: undefined,
  })) as Array<{ _id: string }>
  return Array.isArray(found) && found.length > 0
}

export const rejectDuplicateOrderId = async (context: HookContext, next: NextFunction): Promise<void> => {
  const orderId = clientOrderId(context)
  if (!orderId || isFromSync(context)) return next()

  // Läuft schon ein Versuch mit dieser ID, erst dessen Ausgang abwarten. Die Schleife deckt einen dritten Versuch ab,
  // der sich zwischen Ende des ersten und Start des zweiten eingereiht hat.
  for (let running = inFlight.get(orderId); running; running = inFlight.get(orderId)) await running

  // Ab hier synchron belegen, bevor wieder etwas awaitet: Ein gleichzeitiger Versuch wartet dann auf diesen.
  let settle: () => void = () => undefined
  inFlight.set(
    orderId,
    new Promise<void>(resolve => {
      settle = resolve
    }),
  )
  try {
    if (await exists(context, orderId)) {
      throw new Conflict(AppErrorMessages[AppError.ORDER_ALREADY_EXISTS], {
        code: AppError.ORDER_ALREADY_EXISTS,
        orderId,
      })
    }
    await next()
  } finally {
    inFlight.delete(orderId)
    settle()
  }
}
