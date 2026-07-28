import type { Knex } from 'knex'

// Sync-Fix Standort-Settings (2026-07-28): Der Cloud→Edge-Pull-Apply konnte
// `locations` und `opening-hour-exceptions` nie per CREATE anwenden (Data-
// Schemas lehnten `_id`/`createdAt`/`updatedAt` ab) — die Records wurden still
// rejected, waehrend der `since`-Cursor weiterlief. Nach dem Schema-Fix holt
// dieser einmalige Cursor-Reset die verpassten Records nach: ohne ihn kaemen
// nur ab jetzt geaenderte Cloud-Records, der Bestand (Drucker/Pager/Tische/
// Oeffnungszeiten, materialisierte Feiertage) bliebe dauerhaft fehlend.
// Der folgende Initial-Pull ist idempotent (upsert) — der Reset ist gefahrlos.
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('sync-cursor')
  if (!hasTable) return
  await knex('sync-cursor').whereIn('_id', ['cloud:locations', 'cloud:opening-hour-exceptions']).delete()
}

export async function down(): Promise<void> {
  // Nicht umkehrbar (geloeschte Cursor-Staende sind nicht rekonstruierbar) —
  // und nicht noetig: fehlende Cursor bedeuten nur einen erneuten Initial-Pull.
}
