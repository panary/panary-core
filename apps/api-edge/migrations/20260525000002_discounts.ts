import type { Knex } from 'knex'

/**
 * Migration: discounts-Tabelle (Rabatt-Definitionen).
 *
 * Cloud ist Source of Truth; der Edge spiegelt read-only per Pull-Sync. JSON-
 * Arrays (categoryIds/productExternalIds/customerIds/channels/recurringWeekdays)
 * werden als TEXT abgelegt (Serialisierung via getJsonFieldHooks im Service).
 * Booleans als Integer 0/1 (SQLite) — der Cloud-Sync coerced sie über booleanFields.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('discounts', table => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('name').notNullable()
    table.text('description').nullable()
    table.string('status').notNullable()

    table.string('method').notNullable()
    table.string('target').notNullable()

    table.string('valueType').notNullable()
    table.float('valuePercent').defaultTo(0)
    table.integer('valueCents').defaultTo(0)

    table.string('appliesTo').notNullable()
    table.text('categoryIds').defaultTo('[]')
    table.text('productExternalIds').defaultTo('[]')

    table.string('eligibility').notNullable()
    table.text('customerIds').defaultTo('[]')

    table.string('minRequirementType').notNullable()
    table.integer('minAmountCents').nullable()
    table.integer('minQuantity').nullable()

    table.string('activeFrom').nullable()
    table.string('activeUntil').nullable()
    table.text('recurringWeekdays').defaultTo('[]')
    table.string('recurringStartTime').nullable()
    table.string('recurringEndTime').nullable()

    table.text('channels').defaultTo('[]')

    table.boolean('combinable').defaultTo(false)
    table.boolean('isStaffMeal').defaultTo(false)
    table.boolean('onePerCustomer').defaultTo(false)

    table.integer('usageLimitTotal').nullable()
    table.float('sortIndex').defaultTo(0)

    table.string('_deletedAt').nullable()
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_discounts_tenant ON discounts (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_discounts_tenant_location ON discounts (tenantId, locationId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_discounts_status ON discounts (status)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_discounts_method ON discounts (method)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('discounts')
}
