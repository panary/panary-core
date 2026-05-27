import type { Knex } from 'knex'

/**
 * Migration: cash-sessions-Tabelle (Multi-Kassen-Tagesabschluss).
 *
 * Edge-nativ + bidirektional gesynct (Bargeld wird physisch am POS gehandhabt).
 * `denominationCounts` ist ein JSON-Objekt (TEXT-Blob in SQLite), serialisiert
 * über getJsonFieldHooks im Service. Geld-Felder sind Integer-Cents (kein Float).
 * `_deletedAt` für Soft-Delete-Sync-Tombstones (analog discounts).
 *
 * Tabellenname kebab-case (`cash-sessions`) → Indizes mit gequoteten Identifiern.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('cash-sessions', table => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('businessDayId').notNullable()
    table.string('label').notNullable()
    table.string('status').notNullable()

    table.string('openedBy').notNullable()
    table.string('openedAt').notNullable()
    table.string('closedBy').nullable()
    table.string('closedAt').nullable()
    table.string('deviceId').nullable()

    table.integer('openingFloatCents').defaultTo(0)
    table.text('denominationCounts').nullable() // JSON-Objekt (DenominationCounts)

    table.integer('countedClosingFloatCents').defaultTo(0)
    table.integer('cashSalesCents').defaultTo(0)
    table.integer('cashDropsCents').defaultTo(0)
    table.integer('payoutsCents').defaultTo(0)
    table.integer('expectedClosingFloatCents').defaultTo(0)
    table.integer('varianceCents').defaultTo(0)

    table.text('notes').nullable()

    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()
    table.string('_deletedAt').nullable()
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_cash-sessions_tenant" ON "cash-sessions" (tenantId)')
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS "idx_cash-sessions_tenant_businessday" ON "cash-sessions" (tenantId, businessDayId)',
  )
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS "idx_cash-sessions_tenant_businessday_status" ON "cash-sessions" (tenantId, businessDayId, status)',
  )
  await knex.raw('CREATE INDEX IF NOT EXISTS "idx_cash-sessions_openedby" ON "cash-sessions" (openedBy)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('cash-sessions')
}
