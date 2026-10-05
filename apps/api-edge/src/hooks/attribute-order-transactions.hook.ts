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
 * Before-Hook am `orders`-Service fuer `patch` (**vor** `restrictOrderToCashSession`:
 * die Kassenpruefung sucht die offene Lade des Kassierers anhand von
 * `performedBy` und muss schon den belegten Bediener sehen) und `create`
 * (Zahlungen, die beim Anlegen mitkommen, sind alle neu).
 *
 * Bekannte Transaktionen bekommen ihr **gespeichertes** `performedBy` zurueck —
 * sonst koennte ein Geraet den Kassierer einer schon gebuchten Zahlung
 * umschreiben, indem es sie mit anderem Wert erneut mitschickt.
 */
export const attributeOrderTransactions = async (context: HookContext): Promise<HookContext> => {
  if ((context.method !== 'patch' && context.method !== 'create') || !context.params.provider) return context
  if (!isDeviceSession(context.params.user)) return context

  const data = context.data as { payment?: { transactions?: TransactionLite[] } } | undefined
  if (!data || Array.isArray(data)) return context
  const transactions = data.payment?.transactions
  if (!Array.isArray(transactions) || transactions.length === 0) return context

  const known = new Map<string, TransactionLite>()
  if (context.method === 'patch') {
    if (context.id === null || context.id === undefined) return context
    try {
      const original = (await context.service.get(context.id, { provider: undefined } as never)) as {
        payment?: { transactions?: TransactionLite[] }
      }
      for (const stored of original?.payment?.transactions ?? []) {
        if (typeof stored._id === 'string') known.set(stored._id, stored)
      }
    } catch {
      // Unbekannte Order: Der Patch scheitert ohnehin spaeter; hier nichts umschreiben.
      return context
    }
  }

  data.payment!.transactions = transactions.map(transaction => {
    const stored = typeof transaction._id === 'string' ? known.get(transaction._id) : undefined
    if (stored) return { ...transaction, performedBy: stored.performedBy ?? undefined }
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
