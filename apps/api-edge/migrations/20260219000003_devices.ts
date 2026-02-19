import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('devices', table => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('deviceId').notNullable()
    table.string('name').notNullable()
    table.string('type').notNullable()
    table.string('apiKeyId').nullable()
    table.string('lastSeen').nullable()
    table.boolean('active').defaultTo(true)
    table.text('metadata').nullable()  // { userAgent, ipAddress, version }
    table.string('createdBy').nullable()
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_devices_tenant ON devices (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_devices_location ON devices (locationId)')
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_deviceId ON devices (deviceId)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('devices')
}
