// Migration: Vorgangsnummer je Geschaeftstag eindeutig erzwingen (panary/panary-core#537).
//
// `assignDailySequenceNumber` vergab bis 2026-10 bei mehreren Abschluessen in
// derselben Sekunde dieselbe Nummer. Der Hook zaehlt jetzt `MAX + 1` je
// Geschaeftstag; dieser Index macht aus „sollte eindeutig sein" ein „ist es":
// Ein Duplikat scheitert beim Insert laut, statt still auf zwei Belegen zu stehen.
//
// **Schluessel (businessDayId, dailySequenceNumber)**, nicht das Vierer-Tupel mit
// tenantId/locationId: `businessDayId` ist eine uuid und gehoert genau einer Filiale
// eines Mandanten. Und SQLite behandelt NULL in einem Unique-Index als verschieden —
// eine Bestellung ohne gestempelte tenantId fiele aus dem Vierer-Index still heraus.
//
// **Teilindex ab Migrationszeitpunkt.** Bestandsdaten koennen Duplikate tragen
// (genau das war der Fehler). Ein voller Unique-Index scheiterte dann beim Anlegen,
// und der Edge kaeme nicht mehr hoch. Umschreiben ist keine Option: Die Nummer steht
// auf ausgegebenen Belegen (KassenSichV, Beleg-Snapshot unveraenderbar). Deshalb gilt
// der Index nur fuer Zeilen mit `createdAt` NACH dem Lauf. Das trifft auch
// Bestandsorders, die ein Bootstrap/Restore spaeter aus der Cloud zurueckspielt —
// deren `createdAt` liegt vor dem Stichtag. Neue Nummern kollidieren mit Altbestand
// nicht, weil der Hook ueber dem Maximum des Tages weiterzaehlt.
//
// Gefundene Duplikate werden gezaehlt und gemeldet, nicht veraendert.
//
// 🚫 Kein Import aus `@panary/*`: `migrations/` ist ein Asset-Ordner, der
// einzeln mit `--bundle=false` transpiliert wird; ein Domain-Import fiele zur
// Laufzeit still aus.
import type { Knex } from 'knex'

export const INDEX_NAME = 'uq_orders_businessDay_dailySequenceNumber'

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * SQL des Teil-Unique-Index. SQLite verbietet gebundene Parameter in der
 * WHERE-Klausel eines Teilindex — der Stichtag steht deshalb als Literal drin
 * und wird vorher streng auf das ISO-Format geprueft.
 */
export function uniqueIndexSql(cutoffIso: string): string {
  if (!ISO_TIMESTAMP.test(cutoffIso)) throw new Error(`Ungueltiger Stichtag fuer ${INDEX_NAME}: ${cutoffIso}`)
  return (
    `CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX_NAME} ON orders (businessDayId, dailySequenceNumber) ` +
    `WHERE businessDayId IS NOT NULL AND createdAt > '${cutoffIso}'`
  )
}

export interface DuplicateGroup {
  businessDayId: string
  dailySequenceNumber: number
  n: number
}

/** Bestandsmessung aus dem Issue: Nummern, die im selben Geschaeftstag mehrfach vorkommen. */
export async function findDuplicateSequenceNumbers(knex: Knex): Promise<DuplicateGroup[]> {
  const rows = (await knex('orders')
    .select('businessDayId', 'dailySequenceNumber')
    .count({ n: '*' })
    .whereNotNull('businessDayId')
    .groupBy('businessDayId', 'dailySequenceNumber')
    .having(knex.raw('COUNT(*) > 1'))
    .orderBy('n', 'desc')) as Array<{ businessDayId: string; dailySequenceNumber: number; n: number | string }>
  return rows.map(r => ({ ...r, n: Number(r.n) }))
}

export async function up(knex: Knex, cutoffIso: string = new Date().toISOString()): Promise<void> {
  if (!(await knex.schema.hasTable('orders'))) return

  const duplicates = await findDuplicateSequenceNumbers(knex)
  if (duplicates.length > 0) {
    const affected = duplicates.reduce((sum, d) => sum + d.n, 0)
    console.warn(
      JSON.stringify({
        event: 'migration.orders_daily_sequence_duplicates',
        message:
          'Bestand traegt doppelte Vorgangsnummern je Geschaeftstag (panary/panary-core#537) — ' +
          'nicht veraendert, Unique-Index gilt erst fuer neue Bestellungen',
        groups: duplicates.length,
        orders: affected,
        sample: duplicates.slice(0, 10),
        cutoff: cutoffIso,
      }),
    )
  }

  await knex.raw(uniqueIndexSql(cutoffIso))
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX_NAME}`)
}
