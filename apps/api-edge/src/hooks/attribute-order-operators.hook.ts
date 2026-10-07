// Bediener an Zahlungen und Rabatten aus dem Bediener-Token
// (panary/panary-core#619 Schritt 4b, #631; ADR 0053).
//
// Der POS schickt beim Kassieren `payment.transactions[]` und beim Rabattieren
// `appliedDiscounts[]` als ganze Listen. Umgeschrieben werden nur Eintraege, die
// der gespeicherte Stand noch nicht kennt (Abgleich ueber die vom POS vergebene
// `_id`) — eine gebuchte Zahlung oder ein vergebener Rabatt gehoert dem, der ihn
// damals ausgeloest hat, nicht dem, der jetzt den naechsten Patch schickt.
import type { HookContext } from '@feathersjs/feathers'

import { attributedOperatorId, isDeviceSession } from '../utils/pos-operator-attribution'

interface ListEntry {
  _id?: string
  [field: string]: unknown
}

interface OrderLite {
  payment?: { transactions?: ListEntry[] }
  appliedDiscounts?: ListEntry[]
}

/**
 * Eine Liste mit Bediener-Feld: Bekannte Eintraege bekommen ihren gespeicherten
 * Wert zurueck, neue den Bediener aus dem Token. `onlyClaimed`: nur umschreiben,
 * wenn der Body ueberhaupt einen Menschen nennt — ein automatischer Rabatt
 * (`appliedBy: null`) bleibt ohne Bediener.
 */
const attributeList = (
  context: HookContext,
  entries: ListEntry[],
  stored: ListEntry[] | undefined,
  field: string,
  logField: string,
  onlyClaimed: boolean,
): ListEntry[] => {
  const known = new Map<string, ListEntry>()
  for (const entry of stored ?? []) {
    if (typeof entry._id === 'string') known.set(entry._id, entry)
  }
  return entries.map(entry => {
    const previous = typeof entry._id === 'string' ? known.get(entry._id) : undefined
    if (previous) return { ...entry, [field]: previous[field] ?? undefined }
    const claimed = entry[field]
    if (onlyClaimed && (typeof claimed !== 'string' || !claimed)) return entry
    return {
      ...entry,
      [field]: attributedOperatorId(context.params, claimed, {
        service: 'orders',
        field: logField,
        entityId: context.id,
      }),
    }
  })
}

/**
 * Before-Hook am `orders`-Service fuer `create` und `patch`. Am Patch **vor**
 * `restrictOrderToCashSession`: Die Kassenpruefung sucht die offene Lade des
 * Kassierers anhand von `performedBy` und muss schon den belegten Bediener sehen.
 *
 * Bekannte Eintraege bekommen ihren **gespeicherten** Bediener zurueck — sonst
 * koennte ein Geraet den Kassierer einer gebuchten Zahlung oder den Urheber eines
 * Rabatts umschreiben, indem es den Eintrag mit anderem Wert erneut mitschickt.
 */
export const attributeOrderOperators = async (context: HookContext): Promise<HookContext> => {
  if ((context.method !== 'patch' && context.method !== 'create') || !context.params.provider) return context
  if (!isDeviceSession(context.params.user)) return context

  const data = context.data as OrderLite | undefined
  if (!data || Array.isArray(data)) return context
  const transactions = data.payment?.transactions
  const discounts = data.appliedDiscounts
  const hasTransactions = Array.isArray(transactions) && transactions.length > 0
  const hasDiscounts = Array.isArray(discounts) && discounts.length > 0
  if (!hasTransactions && !hasDiscounts) return context

  let original: OrderLite = {}
  if (context.method === 'patch') {
    if (context.id === null || context.id === undefined) return context
    try {
      original = ((await context.service.get(context.id, { provider: undefined } as never)) as OrderLite) ?? {}
    } catch {
      // Unbekannte Order: Der Patch scheitert ohnehin spaeter; hier nichts umschreiben.
      return context
    }
  }

  if (hasTransactions) {
    data.payment!.transactions = attributeList(
      context,
      transactions!,
      original.payment?.transactions,
      'performedBy',
      'payment.transactions.performedBy',
      false,
    )
  }
  if (hasDiscounts) {
    data.appliedDiscounts = attributeList(
      context,
      discounts!,
      original.appliedDiscounts,
      'appliedBy',
      'appliedDiscounts.appliedBy',
      true,
    )
  }
  return context
}
