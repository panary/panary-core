// Migration: `details`-Spalte zu sync-runs hinzufuegen.
//
// Zweck: Per-Record-Details eines Sync-Vorgangs (Service/Entity-Typ + entityId
// + Operation + Status) als JSON-Array persistieren, damit das Admin-Panel pro
// Sync-Historie-Eintrag exakt anzeigen kann, WELCHE Records ein Push/Pull
// betraf. Bisher wurden nur aggregierte Zaehler gespeichert.
//
// SQLite-TEXT-Spalte: Knex serialisiert beim Insert ein uebergebenes Array
// automatisch als JSON-String; der resolveResult des sync-runs-Service parsed
// beim Lesen zurueck. Kein Index — das Feld wird nur lesend pro Zeile angezeigt.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sync-runs', table => {
    table.text('details').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sync-runs', table => {
    table.dropColumn('details')
  })
}
