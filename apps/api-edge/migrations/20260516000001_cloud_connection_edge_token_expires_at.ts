// Migration: cloud-connection um Token-Ablaufdatum erweitern.
//
// Der Sync-Scheduler spiegelt nach jedem erfolgreichen Sync das Feld
// `tokenExpiresAt` der Cloud-Seite (`cloud-edges`-Collection) hierher.
// Damit kann POS-Client und Admin-Client einen Countdown anzeigen, ohne
// pro Render einen Cloud-Roundtrip zu erzeugen.
//
// Wird vom Health-Endpoint mit ausgegeben, damit der POS-Client den
// Wert RBAC-frei lesen kann (kein `cloud-connection.get()` noetig).
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.string('edgeTokenExpiresAt').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.dropColumn('edgeTokenExpiresAt')
  })
}
