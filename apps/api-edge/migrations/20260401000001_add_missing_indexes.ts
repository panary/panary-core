// Migration: Fehlende Datenbankindizes für Performance-kritische Lookups
// - users: tenantId + zusammengesetzter Index (tenantId, loginname) für Login-Lookups
// - apikeys: tenantId + apikey für WebSocket-Auth
// - cloud-connection: tenantId für Multi-Tenancy-Filter
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // users: tenantId-Index für Multi-Tenancy-Filter
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_users_tenantId ON users (tenantId)')

  // users: zusammengesetzter Index für Login-Lookups (tenantId + loginname)
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_users_tenantId_loginname ON users (tenantId, loginname)')

  // apikeys: tenantId-Index für Multi-Tenancy-Filter
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_apikeys_tenantId ON apikeys (tenantId)')

  // apikeys: apikey-Index für Auth-Lookups
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_apikeys_apikey ON apikeys (apikey)')

  // cloud-connection: tenantId-Index für Multi-Tenancy-Filter
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_cloud-connection_tenantId" ON "cloud-connection" (tenantId)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_users_tenantId')
  await knex.raw('DROP INDEX IF EXISTS idx_users_tenantId_loginname')
  await knex.raw('DROP INDEX IF EXISTS idx_apikeys_tenantId')
  await knex.raw('DROP INDEX IF EXISTS idx_apikeys_apikey')
  await knex.raw('DROP INDEX IF EXISTS "idx_cloud-connection_tenantId"')
}
