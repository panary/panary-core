// Migration: Abrechnungskreis an der Bestellung (#345).
//
// `orders.settlementScope` ist das DSFinV-K-Feld `ABRECHNUNGSKREIS` — die
// Klammer, ueber die ein Pruefer zusammengehoerende Vorgaenge eines Tisches
// nachvollzieht (DSFinV-K Tz. 2.7.1, 3.1.2.2). Im Schema ist es Pflicht; am
// Edge stempelt es `assignSettlementScope()` beim `create`.
//
// Die Spalte entsteht `NOT NULL` mit dem Platzhalter `auto:unset`, nicht
// nullable. Eine nullable Spalte waere der gefaehrlichere Weg: Der Edge
// serialisiert ungesetzte nullable SQLite-Spalten als `null`, und der
// Cloud-Sync-Push wuerde sie gegen `Type.String(...)` mit `must be string`
// verwerfen — `classifyAcceptError` stuft das als TERMINAL ein, also Outbox
// `rejected` ohne Retry und ohne `sync-conflicts`-Eintrag. Der Platzhalter ist
// dagegen ein gueltiger, als synthetisch erkennbarer Wert.
//
// Bleibt nach dieser Migration irgendwo `auto:unset` stehen, hat ein Schreibpfad
// den Hook umgangen. Der Wert ist absichtlich greppbar.
//
// Bestandsdaten:
//   * Bestellung MIT Tisch  -> der Tischwert selbst (unveraendert, getrimmt).
//     Nur so gilt die Eigenschaft, an der das Feld haengt: zwei Bestellungen
//     desselben Tisches tragen denselben Abrechnungskreis.
//   * Bestellung OHNE Tisch -> `auto:backfill-<id-ende>`, je Bestellung ein
//     eigener Kreis. Fachlich richtig (ohne Tisch gibt es nichts zu gruppieren)
//     und an `auto:backfill-` als nachtraeglich gesetzt erkennbar — eine
//     spaetere Auswertung kann „gewachsen" von „gesetzt" unterscheiden.
//
// 🚫 Kein Import aus `@panary/*`: `migrations/` ist ein Asset-Ordner, der
// einzeln mit `--bundle=false` transpiliert wird; ein Domain-Import fiele zur
// Laufzeit still aus. Die Praefixe stehen deshalb als Literale hier und sind
// in `apps/api-edge/test/migrations/` gegen die Domain-Konstante gelockt.
import type { Knex } from 'knex'

/** Spiegelt `SYNTHETIC_SETTLEMENT_SCOPE_PREFIX` aus `@panary/orders/domain`. */
export const SYNTHETIC_PREFIX = 'auto:'
/** Spiegelt `SETTLEMENT_SCOPE_MAX_LENGTH` — Feldlaenge DSFinV-K `ABRECHNUNGSKREIS`. */
export const MAX_LENGTH = 50

export const PLACEHOLDER = `${SYNTHETIC_PREFIX}unset`
export const BACKFILL_PREFIX = `${SYNTHETIC_PREFIX}backfill-`

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('orders'))) return
  if (await knex.schema.hasColumn('orders', 'settlementScope')) return

  await knex.schema.alterTable('orders', table => {
    table.string('settlementScope').notNullable().defaultTo(PLACEHOLDER)
  })

  // `table` ist ein SQL-Schluesselwort und muss ueberall gequotet werden.
  const withTable = await knex('orders')
    .whereNotNull('table')
    .whereRaw(`trim("table") <> ''`)
    .update({
      settlementScope: knex.raw(`substr(trim("table"), 1, ?)`, [MAX_LENGTH]),
    })

  const withoutTable = await knex('orders')
    .where('settlementScope', PLACEHOLDER)
    .update({
      settlementScope: knex.raw(`? || substr("_id", -12)`, [BACKFILL_PREFIX]),
    })

  // Kein `logger` — der waere ein Domain-Import. `console` landet im
  // Container-Log, und eine Datenaenderung dieser Groesse darf nicht unsichtbar
  // passieren.
  console.warn(
    `[migration 20260922100000] Abrechnungskreis gesetzt: ${withTable} aus Tisch, ${withoutTable} synthetisch (${BACKFILL_PREFIX}…)`,
  )
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('orders'))) return
  if (!(await knex.schema.hasColumn('orders', 'settlementScope'))) return

  await knex.schema.alterTable('orders', table => {
    table.dropColumn('settlementScope')
  })
}
