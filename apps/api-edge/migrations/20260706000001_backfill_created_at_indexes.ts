// Migration: (tenantId, createdAt)-Indizes fuer den Bootstrap-Backfill.
//
// `queueBackfillOutbox` (cloud-bootstrap-runner.worker.ts) liest pro
// Transaction-Service die Records der letzten 90 Tage:
// `WHERE tenantId = ? AND createdAt BETWEEN ? AND ?` — seit dem Chunked-Read
// zusaetzlich mit Keyset (`_id > ?`, `ORDER BY _id`, `LIMIT 500`). Keiner der
// drei Backfill-Services hatte bisher einen createdAt-Index (orders nur
// updatedAt/recordingDate, order-interactions nur eventAt, working-times nur
// checkinDate) — auf lange gelaufenen Edges (Jahre an Orders, 90-Tage-Fenster
// = kleiner Ausschnitt) erzwingt das einen Full-Tenant-Scan pro Seite.
//
// Muster wie 20260528000001_perf_indexes: idempotent (IF NOT EXISTS),
// tableExists-Guard fuer schmale Bootstrap-Edges, kebab-case-Tabellennamen
// in Anfuehrungszeichen.
import type { Knex } from 'knex'

interface IndexDefinition {
  readonly table: string
  readonly indexName: string
  readonly definition: string
}

const INDEXES: ReadonlyArray<IndexDefinition> = [
  {
    table: 'orders',
    indexName: 'idx_orders_tenant_created',
    definition: 'orders (tenantId, createdAt)',
  },
  {
    table: 'order-interactions',
    indexName: 'idx_order-interactions_tenant_created',
    definition: '"order-interactions" (tenantId, createdAt)',
  },
  {
    table: 'working-times',
    indexName: 'idx_working-times_tenant_created',
    definition: '"working-times" (tenantId, createdAt)',
  },
]

const tableExists = async (knex: Knex, table: string): Promise<boolean> => {
  const row = await knex
    .select<{ name: string }>('name')
    .from('sqlite_master')
    .where({ type: 'table', name: table })
    .first()
  return !!row
}

export async function up(knex: Knex): Promise<void> {
  for (const idx of INDEXES) {
    if (!(await tableExists(knex, idx.table))) continue
    await knex.raw(`CREATE INDEX IF NOT EXISTS "${idx.indexName}" ON ${idx.definition}`)
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const idx of INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS "${idx.indexName}"`)
  }
}
