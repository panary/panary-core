import type { Knex } from 'knex'

// Stille Rotation der Geraete-API-Keys (Issue #324, ADR 0042).
//
// `pendingApikey*` haelt den frisch ausgestellten Schluessel, WAEHREND `apikey`
// weiter gilt — promotet wird erst beim ersten erfolgreichen Handshake mit dem
// neuen Schluessel. Ohne dieses Zwischenfeld sperrt jeder abgebrochene
// Rotationsversuch das Geraet aus.
//
// BEWUSST kein Backfill von `validUntil`: Alle Bestands-Keys sind heute
// unbefristet. Ein flottenweiter Stempel am Deploy-Tag liesse die 180-Tage-Uhr
// fuer alle Geraete gleichzeitig ablaufen — und damit auch die Rotation aller
// Geraete auf denselben Tag fallen. Stattdessen stempelt der erste Handshake
// jedes Geraets sein eigenes `validUntil` (utils/device-apikey-auth.ts), die
// Uhr startet also pro Geraet bei dessen erstem Kontakt.
//
// Der `deviceId`-Index gehoert hierher, weil der Auth-Lookup mit dieser
// Aenderung nicht mehr ueber `apikeyPrefix` geht: Der rotierte Schluessel hat
// einen anderen Prefix als der gespeicherte, ein Prefix-Lookup faende ihn nicht.
export async function up(knex: Knex): Promise<void> {
  const hasPending = await knex.schema.hasColumn('apikeys', 'pendingApikey')
  if (!hasPending) {
    await knex.schema.alterTable('apikeys', table => {
      table.string('pendingApikey').nullable()
      table.string('pendingApikeyPrefix').nullable()
      table.string('pendingApikeyCreatedAt').nullable()
    })
  }

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_apikeys_deviceId ON apikeys (deviceId)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_apikeys_deviceId')

  const hasPending = await knex.schema.hasColumn('apikeys', 'pendingApikey')
  if (hasPending) {
    await knex.schema.alterTable('apikeys', table => {
      table.dropColumn('pendingApikey')
      table.dropColumn('pendingApikeyPrefix')
      table.dropColumn('pendingApikeyCreatedAt')
    })
  }
}
