import type { Knex } from 'knex'

// panary/panary-core#228: Der Beleg wies den gewaehrten Nachlass nicht aus —
// Positionen unrabattiert, `totalGross` rabattiert, Differenz unerklaert.
// `discounts` traegt den Snapshot (Name + abgezogener Brutto-Betrag) als
// JSON-Text, analog `lineItems`/`taxSummary` (Serialisierung via
// getJsonFieldHooks im receipts-Service).
//
// BEWUSST kein Default und kein Backfill: `NULL` heisst „Beleg ohne Rabatt oder
// vor #228 ausgestellt". Ausgestellte Belege werden nicht nachgerechnet — der
// Snapshot ist unveraenderbar (KassenSichV), und ein Backfill wuerde den
// `renderHash` gegen den ausgelieferten Beleg laufen lassen.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('receipts', table => {
    table.text('discounts').nullable() // ReceiptDiscount[] als JSON-String; NULL = kein Nachlass
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('receipts', table => {
    table.dropColumn('discounts')
  })
}
