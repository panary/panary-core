import type { Knex } from 'knex'

// Feste IDs für Dev-Seeding (idempotent wiederholbar)
const DEV_TENANT_ID = '01968000-0000-7000-8000-000000000001'
const DEV_LOCATION_ID = '01968000-0000-7000-8000-000000000002'

export async function up(knex: Knex): Promise<void> {
  const exists = await knex('locations').where({ _id: DEV_LOCATION_ID }).first()
  if (exists) return

  await knex('locations').insert({
    _id: DEV_LOCATION_ID,
    tenantId: DEV_TENANT_ID,
    name: 'Hauptfiliale',
    status: 'ACTIVE',
    settings: JSON.stringify({}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex('locations').where({ _id: DEV_LOCATION_ID }).delete()
}
