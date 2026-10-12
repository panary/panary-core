import type { Knex } from 'knex'

// Reparatur fuer Edges aus #664: Nach „Alles aus der Cloud uebernehmen" fehlte die
// eigene Location, und jeder Pull scheiterte am CREATE (`locationDataSchema` kannte
// `currentBusinessDay`/`organizationName` nicht). Der `since`-Cursor rueckte trotzdem
// vor — nach dem Schema-Fix kaeme die Location erst mit der naechsten Cloud-Aenderung.
// Dieser einmalige Reset loest den naechsten Pull als Initial-Pull aus, ohne dass der
// Betreiber etwas tun muss. Idempotent (upsert) und damit auch auf gesunden Edges
// gefahrlos — Vorbild: 20260728150000_reset_location_pull_cursors.
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('sync-cursor')
  if (!hasTable) return
  await knex('sync-cursor').whereIn('_id', ['cloud:locations', 'cloud:opening-hour-exceptions']).delete()
}

export async function down(): Promise<void> {
  // Nicht umkehrbar und nicht noetig: ein fehlender Cursor bedeutet nur einen erneuten Initial-Pull.
}
