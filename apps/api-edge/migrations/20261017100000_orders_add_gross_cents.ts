// Migration: gespeichertes Brutto je Bestellung (panary/panary-core#728).
//
// `orders.grossCents` traegt `getOrderGrossCents()` des gespeicherten Stands —
// gestempelt bei jedem create/patch vom Hook `stampOrderGrossCents`. Gebraucht
// wird es fuer die Betragssuche der Bestellliste in der Cloud
// (panary/panary-cloud#1092); der Edge pusht die Spalte mit dem Record.
//
// NULLABLE und ohne Backfill: Gesucht wird nur in der Cloud, und die backfillt
// ihren Bestand selbst. Ein Edge-Backfill muesste den Betrag hier ausrechnen —
// ohne Domain-Import (unten) hiesse das eine zweite Summenformel, genau das, was
// das Feld verhindern soll. Bestandsbons bekommen den Wert beim naechsten Patch.
//
// 🚫 Kein Import aus `@panary/*`: `migrations/` ist ein Asset-Ordner, der
// einzeln mit `--bundle=false` transpiliert wird; ein Domain-Import fiele zur
// Laufzeit still aus.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('orders'))) return

  if (!(await knex.schema.hasColumn('orders', 'grossCents'))) {
    await knex.schema.alterTable('orders', table => {
      table.integer('grossCents').nullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('orders'))) return
  if (await knex.schema.hasColumn('orders', 'grossCents')) {
    await knex.schema.alterTable('orders', table => {
      table.dropColumn('grossCents')
    })
  }
}
