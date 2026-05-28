// Migration: Performance-Indizes fuer UI-Listen + Cloud-Sync-Pull.
//
// Status quo (vor dieser Migration): keine `idx_*_updatedAt`-Indizes auf den
// Master-Data-Tabellen, kein `(tenantId, recordingDate)` auf orders.
// UI-Listen wie POS-Bestellungen-History (`$sort: {recordingDate:-1}`) und
// die Cloud-Pull-Cursor (`updatedAt > since`) zwangen SQLite in einen
// Filesort + Full-Tenant-Scan. Auf einem Sunmi D3 mit ~18.000 Orders nach
// 12 Monaten Betrieb zeigt sich das als 80-120ms je Listen-Render.
//
// Alle Indizes sind `CREATE INDEX IF NOT EXISTS` → idempotent. Edge-bedeutsam:
// Tabellennamen mit Bindestrich (`order-interactions`, `cash-sessions`,
// `working-times`) brauchen Anfuehrungszeichen.
//
// Backup-Hinweis: nach Migration sind die Indizes Teil der .sqlite-Datei
// (kein zusaetzliches Artefakt). Coolify-Backup-Skripte muessen nicht
// angepasst werden.
import type { Knex } from 'knex'

interface IndexDefinition {
  readonly table: string
  readonly indexName: string
  readonly definition: string
}

const INDEXES: ReadonlyArray<IndexDefinition> = [
  // orders: UI-Listen (recordingDate DESC) + Sync-Pull-Cursor (updatedAt).
  {
    table: 'orders',
    indexName: 'idx_orders_tenant_recording',
    definition: 'orders (tenantId, locationId, recordingDate DESC)',
  },
  {
    table: 'orders',
    indexName: 'idx_orders_tenant_updated',
    definition: 'orders (tenantId, updatedAt)',
  },
  {
    table: 'orders',
    indexName: 'idx_orders_tenant_status_updated',
    definition: 'orders (tenantId, status, updatedAt)',
  },

  // order-interactions: Storno-/Cancel-Analytics + Cloud-Sync-Pull.
  {
    table: 'order-interactions',
    indexName: 'idx_order-interactions_tenant_event',
    definition: '"order-interactions" (tenantId, eventAt DESC)',
  },
  {
    table: 'order-interactions',
    indexName: 'idx_order-interactions_tenant_user_event',
    definition: '"order-interactions" (tenantId, userId, eventAt DESC)',
  },

  // products / customers: Sync-Pull-Cursor.
  {
    table: 'products',
    indexName: 'idx_products_tenant_updated',
    definition: 'products (tenantId, updatedAt)',
  },
  {
    table: 'customers',
    indexName: 'idx_customers_tenant_updated',
    definition: 'customers (tenantId, updatedAt)',
  },

  // businessdays: Sync-Pull-Cursor + Tagesabschluss-Refresh.
  {
    table: 'businessdays',
    indexName: 'idx_businessdays_tenant_updated',
    definition: 'businessdays (tenantId, updatedAt)',
  },

  // working-times: Stempelzeiten-Listen sortieren nach checkinDate.
  {
    table: 'working-times',
    indexName: 'idx_working-times_tenant_checkin',
    definition: '"working-times" (tenantId, checkinDate DESC)',
  },

  // cash-sessions: Offene/Vorgaenger-Lookup laeuft ueber openedAt DESC.
  {
    table: 'cash-sessions',
    indexName: 'idx_cash-sessions_tenant_opened',
    definition: '"cash-sessions" (tenantId, locationId, openedAt DESC)',
  },

  // sync-outbox: lookup by entityId fuer Reapply/Re-Enqueue-Loops.
  {
    table: 'sync-outbox',
    indexName: 'idx_sync-outbox_entityId',
    definition: '"sync-outbox" (entityId)',
  },
]

const tableExists = async (knex: Knex, table: string): Promise<boolean> => {
  // SQLite-Information liegt in sqlite_master.
  const row = await knex
    .select<{ name: string }>('name')
    .from('sqlite_master')
    .where({ type: 'table', name: table })
    .first()
  return !!row
}

export async function up(knex: Knex): Promise<void> {
  for (const idx of INDEXES) {
    // Defensiv: existiert die Tabelle gar nicht (frischer Edge ohne Bestelldaten),
    // wird der Index uebersprungen. So bleibt die Migration auch in einem
    // schmalen Bootstrap-Edge idempotent.
    if (!(await tableExists(knex, idx.table))) continue
    await knex.raw(`CREATE INDEX IF NOT EXISTS "${idx.indexName}" ON ${idx.definition}`)
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const idx of INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS "${idx.indexName}"`)
  }
}
