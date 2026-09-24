// Migration: order-references-Tabelle (Vorgangs-Referenzen, DSFinV-K Bon_Referenzen).
//
// DSFinV-K Tz. 4.2.2 verlangt woertlich: „Um einen Bezug zum urspruenglichen
// Vorgang zu ermoeglichen, MUSS ein Datensatz in der Datei `Bon_Referenzen`
// angelegt werden." Erster Nutzer ist der Storno; Split und Umbuchung folgen
// mit panary/panary-core#349.
//
// Append-only wie audit-events — Immutability auf zwei Schichten:
//   1. App-Layer: Service registriert nur find/get/create
//      (apps/api-edge/src/services/order-references/order-references.ts).
//   2. DB-Layer: SQLite-Trigger werfen RAISE(FAIL, ...) bei UPDATE/DELETE und
//      fangen damit einen direkten Knex-Bypass ab.
//
// Die `ref*`-Spalten sind bewusst KOPIEN des referenzierten Vorgangs, keine
// Joins: Ein Join liefert den heutigen Stand, das Gutachten zu #345 (10.3
// Punkt 4) verlangt aber den Stand zum Zeitpunkt des Bezugs.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order-references', table => {
    table.string('_id').primary()

    // Tenant-/Location-Bezug (aus baseSchema)
    table.string('tenantId').notNullable()
    table.string('locationId').notNullable()

    table.string('refType').notNullable() // Transaktion | Storno | Split | Umbuchung

    // Der referenzierte (urspruengliche) Vorgang — DSFinV-K REF_BON_ID.
    table.string('sourceOrderId').notNullable()
    // Der erzeugende Vorgang. NULL beim Storno: dort entsteht kein neuer
    // Vorgang, der bestehende wechselt nur auf ABORTED.
    table.string('targetOrderId').nullable()

    // Zustand des referenzierten Vorgangs zum Zeitpunkt der Referenzierung.
    table.string('refDate').notNullable() // ISO 8601 — DSFinV-K REF_DATUM
    table.string('refLocationId').notNullable() // analog REF_Z_KASSE_ID
    // NULL im Standalone-Modus: dort laeuft die Kasse ohne Geschaeftstag.
    table.string('refBusinessDayId').nullable() // analog REF_Z_NR

    table.string('createdAt').notNullable()
    table.string('updatedAt').notNullable()
  })

  // Tenant-prefixed Indizes — jede Query laeuft ueber tenantId (multiTenancy()-Hook).
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_order-references_tenant_source" ON "order-references" (tenantId, sourceOrderId)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_order-references_tenant_target" ON "order-references" (tenantId, targetOrderId)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_order-references_tenant_type_date" ON "order-references" (tenantId, refType, refDate DESC)',
  )
  // Sync-Backfill laeuft ueber createdAt, Sync-Pull ueber updatedAt.
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_order-references_tenant_created" ON "order-references" (tenantId, createdAt)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_order-references_tenant_updated" ON "order-references" (tenantId, updatedAt)',
  )

  // Append-only-Trigger. Keine Whitelist: Wer hier spaeter aufraeumen will,
  // muss die Trigger bewusst droppen — genau die Huerde ist der Zweck.
  await knex.schema.raw(`
    CREATE TRIGGER IF NOT EXISTS order_references_no_update
    BEFORE UPDATE ON "order-references"
    BEGIN
      SELECT RAISE(FAIL, 'order-references ist append-only — UPDATE nicht erlaubt');
    END;
  `)
  await knex.schema.raw(`
    CREATE TRIGGER IF NOT EXISTS order_references_no_delete
    BEFORE DELETE ON "order-references"
    BEGIN
      SELECT RAISE(FAIL, 'order-references ist append-only — DELETE nicht erlaubt');
    END;
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TRIGGER IF EXISTS order_references_no_update')
  await knex.schema.raw('DROP TRIGGER IF EXISTS order_references_no_delete')
  await knex.schema.dropTableIfExists('order-references')
}
