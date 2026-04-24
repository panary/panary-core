import type { Knex } from 'knex'

/**
 * Migrationsskript: Device-Rolle 'device:pos' zu 'device:pos-client' umbenennen.
 *
 * Hintergrund: Der Projekt-/App-Name wurde von pos zu pos-client vereinheitlicht.
 * Die DEVICE_POS-Enum-Value in libs/domains/users/domain/src/lib/user.schema.ts
 * zieht diesen Namen nach. Bestehende API-Keys in der Edge-SQLite-Datenbank
 * tragen aber noch die alte Rolle 'device:pos' und muessen migriert werden,
 * damit die Login- und RBAC-Logik sie weiterhin erkennt.
 *
 * Cloud-MongoDB wird nicht durch diese Migration abgedeckt — dort ist eine
 * eigene Migration im Cloud-Deployment erforderlich.
 */
export async function up(knex: Knex): Promise<void> {
  await knex('apikeys').where({ role: 'device:pos' }).update({ role: 'device:pos-client' })
}

export async function down(knex: Knex): Promise<void> {
  await knex('apikeys').where({ role: 'device:pos-client' }).update({ role: 'device:pos' })
}
