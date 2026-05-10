// Migration: optionale User-ID-Allowlist fuer den `bootstrap-edge-to-cloud`-Push.
// Wenn beim Pairing-Wizard eine Auswahl gespeichert wird, pusht der Bootstrap-
// Worker ausschliesslich Users mit diesen IDs. JSON-String (Array<string>) im
// TEXT-Feld — JSON-Hook im Service sorgt fuer Stringify/Parse.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.text('bootstrapUserAllowlist').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.dropColumn('bootstrapUserAllowlist')
  })
}
