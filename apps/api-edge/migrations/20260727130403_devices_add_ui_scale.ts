import type { Knex } from 'knex'

// PNRY-FEAT-POS-UI-SCALE-001: Terminal-eigene UI-Skalierung. Objekt-Feld
// { density, factors? } — analog `metadata` als JSON-Text gespeichert
// (Serialisierung via getJsonFieldHooks im devices-Service).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', table => {
    table.text('uiScale').nullable() // { density, factors? } als JSON-String
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', table => {
    table.dropColumn('uiScale')
  })
}
