// Migration: Split-Gegenbuchungen an der Bestellung (panary/panary-core#349).
//
// `orders.splitOff` haelt append-only fest, welche Menge welcher Zeile in
// welchen Vorgang gewandert ist. Es ist der Weg, auf dem sich zwei
// Anforderungen des Rechtsgutachtens zu panary/panary-core#345 gleichzeitig
// erfuellen lassen, die einander zu widersprechen scheinen:
//
//   A5  Die Quellzeile bleibt bestehen — kein `UPDATE` auf Menge, Preis,
//       Steuersatz oder Zuordnung.
//   A13 Ueber denselben Umsatz stehen keine zwei nicht-stornierten Belege
//       (§ 14c UStG) — die Quelle darf nach dem Split nicht mehr den vollen
//       Betrag tragen.
//
// Aufloesung: Gegenbuchung statt Aenderung. `lineItems` bleibt unangetastet,
// und `effectiveLineItems()` (@panary/orders/domain) leitet ab, was der Vorgang
// noch traegt. Details in ADR 0049.
//
// `splitRoundingRemainderCents` traegt die Differenz zwischen Ursprungsbetrag
// und der Summe der Teilbelege (A14). Sie bleibt stehen und wird nicht
// geglaettet — ein nachtraeglich korrigierter Cent ist von einem Rechenfehler
// nicht mehr zu unterscheiden. Der Wert darf negativ sein.
//
// Beide Spalten sind NULLABLE, anders als `settlementScope` in der Migration
// davor: Dort war der Null-Wert das Problem (Pflichtfeld im Schema, `must be
// string` beim Sync-Push). Hier ist das Feld auch im Schema optional und traegt
// einen expliziten `Type.Null()`-Zweig — genau wegen dieser Serialisierung.
// Ein Bestands-Default waere zudem eine Aussage, die nicht stimmt: Eine nie
// gesplittete Bestellung hat keine Gegenbuchung, nicht „eine leere".
//
// 🚫 Kein Import aus `@panary/*`: `migrations/` ist ein Asset-Ordner, der
// einzeln mit `--bundle=false` transpiliert wird; ein Domain-Import fiele zur
// Laufzeit still aus.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('orders'))) return

  if (!(await knex.schema.hasColumn('orders', 'splitOff'))) {
    await knex.schema.alterTable('orders', table => {
      // JSON-Array, serialisiert von `getJsonFieldHooks` (ORDER_JSON_FIELDS).
      table.text('splitOff').nullable()
    })
  }

  if (!(await knex.schema.hasColumn('orders', 'splitRoundingRemainderCents'))) {
    await knex.schema.alterTable('orders', table => {
      table.integer('splitRoundingRemainderCents').nullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('orders'))) return
  await knex.schema.alterTable('orders', table => {
    table.dropColumn('splitOff')
    table.dropColumn('splitRoundingRemainderCents')
  })
}
