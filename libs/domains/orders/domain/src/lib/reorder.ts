import { isSyntheticSettlementScope } from './settlement-scope'

// Nachbestellen aus einer offenen Bestellung (ADR 0063 Nr. 1 und 6, core#1140).
//
// Im Domain-Paket und nicht in der Komponente: Ob es „Nachbestellen" gibt, ist eine fachliche Regel, testbar ohne
// eine Komponente zu rendern, und gilt für Einzel- und Kreis-Karte gleich.

/** Vorbelegung der Kasse: Tisch und Abrechnungskreis der Bestellung, aus der nachbestellt wird. */
export type KasseReorder = { table: string; settlementScope: string }

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
