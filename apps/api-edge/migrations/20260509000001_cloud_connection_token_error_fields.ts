// Migration: cloud-connection um Token-Error-Tracking erweitern.
//
// Wenn die Cloud auf einen Sync-Call mit 401 antwortet ('Edge-Token abgelaufen'
// oder 'Cloud-Edge widerrufen'), schaltet der Sync-Scheduler den
// pairingStatus auf DISCONNECTED und protokolliert hier den Zeitpunkt und
// Grund — damit Setup- und POS-Client den Re-Pairing-Bedarf sichtbar machen
// koennen, statt still in einer 401-Retry-Schleife zu haengen.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.string('lastTokenErrorAt').nullable()
    table.string('tokenErrorReason').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.dropColumn('lastTokenErrorAt')
    table.dropColumn('tokenErrorReason')
  })
}
