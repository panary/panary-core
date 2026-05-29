import type { Knex } from 'knex'

/**
 * Migration: receipts-Tabelle (persistente Belege, §146a AO).
 *
 * Edge-originated, immutable ausgestellte Artefakte (ADR beleg-bon-system).
 * JSON-Spalten (lineItems/taxSummary/seller/tse/channelsUsed) als TEXT —
 * Serialisierung via getJsonFieldHooks im Service. Monetäre Werte als float
 * (Währungseinheiten, konsistent zur Order — keine Cent-Umrechnung). Cloud-Sync
 * folgt in Phase 2 (Edge → Cloud, Tombstones via _deletedAt).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('receipts', table => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()
    table.string('_deletedAt').nullable()

    table.string('kind').notNullable()
    table.string('status').notNullable()
    table.string('receiptNumber').nullable()
    table.string('orderId').notNullable()
    table.integer('dailySequenceNumber').defaultTo(0)
    table.string('issuedAt').nullable()
    table.string('currency').defaultTo('EUR')

    table.text('lineItems').defaultTo('[]')
    table.text('taxSummary').nullable()
    table.float('totalGross').defaultTo(0)
    table.string('paymentMethod').nullable()
    table.string('paymentState').nullable()
    table.text('seller').nullable()
    table.text('tse').nullable()

    table.string('token').notNullable()
    table.text('channelsUsed').defaultTo('[]')
    table.string('renderHash').nullable()
    table.string('retainUntil').nullable()
    table.string('voidedReceiptId').nullable()
  })

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_receipts_tenant ON receipts (tenantId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_receipts_tenant_location ON receipts (tenantId, locationId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_receipts_order ON receipts (orderId)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_receipts_token ON receipts (token)')
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts (createdAt)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('receipts')
}
