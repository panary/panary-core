// Migration: audit-events-Tabelle (Tenant-Level-Audit-Trail).
//
// Append-only Persistenz fuer geschaeftskritische Mutationen (Storno, Refund,
// Preisaenderungen, Permission-Changes, Login etc.). Tenant-isoliert per
// tenantId-prefixed Indizes. Immutability auf zwei Schichten:
//   1. App-Layer: Service erlaubt extern keine update/patch/remove (siehe
//      apps/api-edge/src/services/audit-events/audit-events.ts).
//   2. DB-Layer: SQLite-Trigger werfen RAISE(FAIL, ...) bei UPDATE/DELETE —
//      faengt direkten Knex-Bypass ab.
//
// Verschachtelte Felder (actor, target, before, after, diff, metadata) werden
// als JSON-Strings persistiert. Die haeufig gefilterten Felder
// `actor.userId`, `target.resource`, `target.entityType`, `target.entityId`
// werden zusaetzlich als flache Spalten gespeichert, damit Indizes greifen.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('audit-events', table => {
    table.string('_id').primary()

    // Tenant-/Location-Bezug (aus baseSchema)
    table.string('tenantId').notNullable()
    table.string('locationId').nullable() // null = tenant-globaler Eintrag (z. B. Login)

    table.string('occurredAt').notNullable() // ISO 8601
    table.string('action').notNullable()
    table.string('category').notNullable()
    table.string('outcome').notNullable() // SUCCESS | FAILURE
    table.string('severity').notNullable() // INFO | NOTICE | WARNING | ALERT
    table.string('correlationId').notNullable() // = requestId aus canonicalLog

    // Flache Index-Spalten (Werte werden zusaetzlich im JSON-Payload gehalten,
    // hier flach fuer Index-Lookups).
    table.string('actor_userId').notNullable()
    table.string('target_resource').notNullable()
    table.string('target_entityType').notNullable()
    table.string('target_entityId').notNullable()

    // Voller Payload (JSON-Strings)
    table.text('actor').notNullable() // serialisiertes AuditActor
    table.text('target').notNullable() // serialisiertes AuditTarget
    table.text('before').nullable()
    table.text('after').nullable()
    table.text('diff').nullable()
    table.text('metadata').nullable()

    table.string('createdAt').notNullable() // identisch zu occurredAt
    table.string('updatedAt').notNullable() // identisch zu createdAt; nur fuer Schema-Konsistenz
  })

  // Tenant-prefixed Indizes (alle Queries laufen ueber tenantId — multiTenancy()-Hook)
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_audit-events_tenant_time" ON "audit-events" (tenantId, occurredAt DESC)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_audit-events_tenant_resource_time" ON "audit-events" (tenantId, target_resource, occurredAt DESC)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_audit-events_tenant_actor_time" ON "audit-events" (tenantId, actor_userId, occurredAt DESC)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_audit-events_tenant_entity" ON "audit-events" (tenantId, target_entityType, target_entityId)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_audit-events_tenant_category_time" ON "audit-events" (tenantId, category, occurredAt DESC)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_audit-events_tenant_action_time" ON "audit-events" (tenantId, action, occurredAt DESC)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_audit-events_correlation" ON "audit-events" (correlationId)',
  )
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS "idx_audit-events_tenant_location_time" ON "audit-events" (tenantId, locationId, occurredAt DESC)',
  )

  // Append-only-Trigger: SQLite faengt jede UPDATE/DELETE-Operation auf der
  // Tabelle ab. Keine Whitelist — wenn der 90d-Cleanup-Job (Phase 1.5)
  // implementiert wird, muss er die Trigger temporaer droppen.
  await knex.schema.raw(`
    CREATE TRIGGER IF NOT EXISTS audit_events_no_update
    BEFORE UPDATE ON "audit-events"
    BEGIN
      SELECT RAISE(FAIL, 'audit-events ist append-only — UPDATE nicht erlaubt');
    END;
  `)
  await knex.schema.raw(`
    CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
    BEFORE DELETE ON "audit-events"
    BEGIN
      SELECT RAISE(FAIL, 'audit-events ist append-only — DELETE nicht erlaubt');
    END;
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP TRIGGER IF EXISTS audit_events_no_update')
  await knex.schema.raw('DROP TRIGGER IF EXISTS audit_events_no_delete')
  await knex.schema.dropTableIfExists('audit-events')
}
