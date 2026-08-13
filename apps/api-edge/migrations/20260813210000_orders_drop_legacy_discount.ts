import type { Knex } from 'knex'

// ADR 0030: Das Legacy-Rabattfeld `orders.discount` ist abgeschafft — es gibt genau
// eine Rabattquelle, und das ist `appliedDiscounts`. Die Spalte war eine JSON-Text-
// Spalte (`{ discountType, discount }`).
//
// BEWUSST kein Backfill nach `appliedDiscounts`: Eine Umschreibung bestehender,
// womoeglich bereits TSE-signierter Vorgaenge verstiesse gegen die
// KassenSichV-Unveraenderbarkeit. Bestand wird vor dem Rollout erkannt und berichtet,
// nicht repariert — Erkennungs-Query siehe docs/domains/rabatte.md.
//
// `down` stellt die Spalte strukturell wieder her, aber LEER: Die Werte sind mit dem
// Drop weg. Das ist die ehrliche Rueckabwicklung — ein `down`, das so tut, als koenne
// es Daten zurueckholen, waere schlimmer als eines, das es nicht behauptet.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.dropColumn('discount')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.text('discount').nullable()
  })
}
