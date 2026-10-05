// `performedBy` neuer Zahlungen aus dem Bediener-Token (panary/panary-core#619, ADR 0053, Schritt 4b).
//
// Der POS schickt beim Kassieren `payment` mit der Transaktionsliste. Umgeschrieben
// werden nur Transaktionen, die der gespeicherte Stand noch nicht kennt (Abgleich
// ueber die vom POS vergebene `_id`) — eine bereits gebuchte Zahlung gehoert dem,
// der sie damals kassiert hat, nicht dem, der jetzt den naechsten Patch schickt.
import type { HookContext } from '@feathersjs/feathers'

import { attributedOperatorId, isDeviceSession } from '../utils/pos-operator-attribution'

interface TransactionLite {
  _id?: string
  performedBy?: string | null
}

/**
 * Before-Patch-Hook am `orders`-Service, **vor** `restrictOrderToCashSession`:
 * Die Kassenpruefung sucht die offene Lade des Kassierers anhand von
 * `performedBy` und muss deshalb schon den belegten Bediener sehen.
 */
export const attributeOrderTransactions = async (context: HookContext): Promise<HookContext> => {
  if (context.method !== 'patch' || !context.params.provider) return context
  if (!isDeviceSession(context.params.user)) return context
  if (context.id === null || context.id === undefined) return context

  const data = context.data as { payment?: { transactions?: TransactionLite[] } } | undefined
  const transactions = data?.payment?.transactions
  if (!Array.isArray(transactions) || transactions.length === 0) return context

  let known = new Set<string>()
  try {
    const original = (await context.service.get(context.id, { provider: undefined } as never)) as {
      payment?: { transactions?: TransactionLite[] }
    }
    known = new Set(
      (original?.payment?.transactions ?? []).map(t => t._id).filter((id): id is string => typeof id === 'string'),
    )
  } catch {
    // Unbekannte Order: Der Patch scheitert ohnehin spaeter; hier nichts umschreiben.
    return context
  }

  data!.payment!.transactions = transactions.map(transaction => {
    if (typeof transaction._id === 'string' && known.has(transaction._id)) return transaction
    return {
      ...transaction,
      performedBy: attributedOperatorId(context.params, transaction.performedBy, {
        service: 'orders',
        field: 'payment.transactions.performedBy',
        entityId: context.id,
      }),
    }
  })
  return context
}
