import type { Knex } from 'knex'

/**
 * Migration: orders um `cashSessionId` erweitern.
 *
 * Verknüpft eine Bestellung mit der Kassen-Session (cash-session), gestempelt
 * vom restrictOrderToCashSession-Guard (Cloud-Modus, pos-cashier). Nullable
 * ohne Default — bestehende Orders + Standalone/orders-only bleiben gültig
 * (NULL). Gleiches Muster wie businessDayId/preOrderId.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.string('cashSessionId').nullable()
  })
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_orders_cash_session ON orders (cashSessionId)')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', table => {
    table.dropColumn('cashSessionId')
  })
}
