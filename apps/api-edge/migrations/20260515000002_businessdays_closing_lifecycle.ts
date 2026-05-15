// Migration: businessdays-Tabelle um Closing-Lifecycle-Felder erweitern.
//
// Hintergrund: Tagesabschluss-Workflow benötigt status-Maschine
// (open → closing-requested → closing-aggregating → closed/failed → audited),
// Mode-Snapshot pro Tag, Cash-Drawer-Werte (nur pos-cashier) und Verknüpfung
// zum Cloud-Report. Geldbeträge als INTEGER (Cents), kein Float.
//
// `isOpen` bleibt für Backwards-Compat (älterer Code liest das Feld) und
// wird vom Service-Resolver konsistent zu `status === 'open'` gehalten.

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('businessdays', table => {
    table.string('status').notNullable().defaultTo('open')
    table.string('operationMode').notNullable().defaultTo('pos-cashier')
    table.string('openedBy').nullable()
    table.string('closedBy').nullable()
    table.integer('openingFloatCents').nullable()
    table.integer('countedClosingFloatCents').nullable()
    table.string('reportId').nullable()
    table.text('reportErrorMessage').nullable()
  })

  // Bestandstage auf "closed" stempeln, wenn `closedAt` gesetzt ist —
  // sonst hängen sie im neuen Default 'open' fest.
  await knex.raw(
    `UPDATE businessdays SET status = 'closed' WHERE closedAt IS NOT NULL AND closedAt != ''`,
  )

  // Index für Pre-Check "ist heute schon ein Tag offen für diese Location?"
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_businessdays_tenant_location_status ON businessdays (tenantId, locationId, status)`,
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_businessdays_tenant_location_status')
  await knex.schema.alterTable('businessdays', table => {
    table.dropColumn('status')
    table.dropColumn('operationMode')
    table.dropColumn('openedBy')
    table.dropColumn('closedBy')
    table.dropColumn('openingFloatCents')
    table.dropColumn('countedClosingFloatCents')
    table.dropColumn('reportId')
    table.dropColumn('reportErrorMessage')
  })
}
