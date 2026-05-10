// Migration: cloud-connection um Pairing-Wizard- und Sync-Mode-Felder erweitern (M7.2)
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.string('initialDirection').nullable()
    table.string('bootstrapStatus').nullable()
    table.string('bootstrapStartedAt').nullable()
    table.string('bootstrapCompletedAt').nullable()
    table.string('bootstrapResumeToken').nullable()
    table.text('bootstrapError').nullable()
    table.text('preflightSnapshot').nullable() // JSON-String, via getJsonFieldHooks geparst
    table.string('tenantIdRestampedAt').nullable()
    table.string('preTenantIdRestampBackupPath').nullable()

    table.string('syncMode').nullable()
    table.integer('syncIntervalSec').nullable()
    table.text('syncSchedule').nullable() // JSON-String
    table.string('lastManualSyncAt').nullable()
    table.string('lastScheduledSyncAt').nullable()
    table.float('lastClockSkewMs').nullable()
    table.integer('outboxBacklog').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.dropColumn('initialDirection')
    table.dropColumn('bootstrapStatus')
    table.dropColumn('bootstrapStartedAt')
    table.dropColumn('bootstrapCompletedAt')
    table.dropColumn('bootstrapResumeToken')
    table.dropColumn('bootstrapError')
    table.dropColumn('preflightSnapshot')
    table.dropColumn('tenantIdRestampedAt')
    table.dropColumn('preTenantIdRestampBackupPath')
    table.dropColumn('syncMode')
    table.dropColumn('syncIntervalSec')
    table.dropColumn('syncSchedule')
    table.dropColumn('lastManualSyncAt')
    table.dropColumn('lastScheduledSyncAt')
    table.dropColumn('lastClockSkewMs')
    table.dropColumn('outboxBacklog')
  })
}
