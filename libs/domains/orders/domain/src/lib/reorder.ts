import { isSyntheticSettlementScope } from './settlement-scope'

// Nachbestellen aus einer offenen Bestellung (ADR 0063 Nr. 1 und 6, core#1140).
//
// Im Domain-Paket und nicht in einer der beiden Komponenten: Die Liste „Offen" entscheidet, ob es die Aktion gibt,
// die Kasse liest die Vorbelegung aus dem Navigations-State. Beide müssen dieselbe Regel lesen, und ein
// Navigations-State ist ungetypt — er kommt durch die History des Browsers und ist nach einem Neuladen fort.

/** Vorbelegung der Kasse: Tisch und Abrechnungskreis der Bestellung, aus der nachbestellt wird. */
export type KasseReorder = { table: string; settlementScope: string }

/** Schlüssel im Navigations-State von `/kasse`. */
export const KASSE_REORDER_STATE_KEY = 'kasseReorder'

/**
 * Vorbelegung für eine offene Bestellung, oder `null`, wenn sich nicht nachbestellen lässt.
 *
 * Ohne Tisch gibt es keinen Kreis zum Anhängen. Ein synthetischer Kreis (`auto:`) gehört zu genau einer Bestellung;
 * eine Nachbestellung dort hätte keinen Tisch, an dem der Edge sie wiederfindet.
 */
export function kasseReorderFor(order: {
  table?: string | null
  settlementScope?: string | null
}): KasseReorder | null {
  const table = typeof order.table === 'string' ? order.table.trim() : ''
  const scope = typeof order.settlementScope === 'string' ? order.settlementScope.trim() : ''
  if (!table || !scope || isSyntheticSettlementScope(scope)) return null
  return { table, settlementScope: scope }
}

/** Liest die Vorbelegung aus einem Navigations-State. Alles, was nicht genau passt, ist keine. */
export function kasseReorderFromState(state: unknown): KasseReorder | null {
  if (!state || typeof state !== 'object') return null
  const value = (state as Record<string, unknown>)[KASSE_REORDER_STATE_KEY]
  if (!value || typeof value !== 'object') return null
  const { table, settlementScope } = value as Record<string, unknown>
  if (typeof table !== 'string' || typeof settlementScope !== 'string') return null
  return kasseReorderFor({ table, settlementScope })
}
