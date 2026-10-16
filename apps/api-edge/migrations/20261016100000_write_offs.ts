// Migration: write-offs-Tabelle (Abschreibungen am Edge, panary/panary-core#635).
//
// Der POS-Dialog speicherte bis hierher über `app.service('write-offs')` ins Leere: Am Edge gab es
// weder Service noch Tabelle. Abschreibungen werden jetzt am Edge gespeichert (offline-fähig) und
// per Edge→Cloud-Push übertragen; die Cloud bucht den Bestand beim Sync-Eingang genau einmal.
//
// Append-only auf zwei Schichten, wie order-references:
//   1. App-Layer: Service registriert nur find/get/create
//      (apps/api-edge/src/services/write-offs/write-offs.ts).
//   2. DB-Layer: Trigger werfen RAISE(FAIL, ...) bei UPDATE/DELETE.
//
// Spalten folgen `writeOffSchema` (@panary/write-offs/domain), aber ohne Import: Migrationen werden
// als Assets mit `--bundle=false` transpiliert, ein Domain-Import liesse sie still ausfallen
// (docs/log.d/2026-09-12-275-bestandsmigration-owner.md).
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('write-offs', table => {
    table.string('_id').primary()

    table.string('tenantId').notNullable()
    table.string('locationId').notNullable()
    table.string('businessDayId').notNullable()

    // Polymorphe Referenz: ingredient | product | recipe
    table.string('itemType').notNullable()
    table.string('itemId').notNullable()
    table.string('itemName').notNullable()
    table.integer('itemVersion').notNullable()

    table.float('quantity').notNullable()
    table.string('unit').notNullable()
    table.float('costPerUnit').notNullable()
    table.float('totalCost').notNullable()

    table.string('reason').notNullable()
    table.string('wasteType').nullable()

    // Bediener aus dem Bediener-Token (ADR 0053), nicht aus dem Body.
    table.string('userId').notNullable()
    table.text('comment').nullable()

    table.string('createdAt').notNullable()
    table.string('updatedAt').notNullable()
  })

  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_write-offs_tenant_location_created" ON "write-offs" (tenantId, locationId, createdAt)',
  )
  // Sync-Pull/Backfill filtern über updatedAt.
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_write-offs_tenant_updated" ON "write-offs" (tenantId, updatedAt)',
  )

  await knex.schema.raw(`
    CREATE TRIGGER IF NOT EXISTS write_offs_no_update
    BEFORE UPDATE ON "write-offs"
    BEGIN
      SELECT RAISE(FAIL, 'write-offs ist append-only — UPDATE nicht erlaubt');
    END;
  `)
  await knex.schema.raw(`
    CREATE TRIGGER IF NOT EXISTS write_offs_no_delete
    BEFORE DELETE ON "write-offs"
    BEGIN
      SELECT RAISE(FAIL, 'write-offs ist append-only — DELETE nicht erlaubt');
    END;
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TRIGGER IF EXISTS write_offs_no_delete')
  await knex.schema.raw('DROP TRIGGER IF EXISTS write_offs_no_update')
  await knex.schema.dropTableIfExists('write-offs')
}
