// Fokus-Test fuer die Outbox-Retention (Phase 2 des Audit-Cleanup-Workers).
//
// Isolierte In-Memory-SQLite statt App-Boot: `runOutboxRetention` ist eine
// reine Knex-Funktion — App-Hooks/Services spielen hier keine Rolle. Das
// Tabellen-Layout entspricht den Migrationen 20260502000003_sync_outbox +
// 20260519000001_sync_outbox_retry_fields (nach Kebab-Rename).
import assert from 'assert'
import type { Knex } from 'knex'
import knexFactory from 'knex'

import { runOutboxRetention } from '../../src/workers/audit-cleanup.worker'

const DAY_MS = 86_400_000
// Feste Referenzzeit — die Retention rechnet gegen `options.now`, damit der
// Test deterministisch bleibt (keine Abhaengigkeit von der Systemuhr).
const NOW = new Date('2026-07-01T12:00:00.000Z')
const AUDIT_RETENTION_DAYS = 90

const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY_MS).toISOString()

describe('audit-cleanup worker — outbox retention', () => {
  let db: Knex

  const insertOutboxRow = async (row: {
    _id: string
    service?: string
    status?: string
    syncedAt?: string | null
  }): Promise<void> => {
    await db('sync-outbox').insert({
      _id: row._id,
      service: row.service ?? 'orders',
      op: 'create',
      entityId: `entity-${row._id}`,
      payload: null,
      occurredAt: daysAgo(120),
      syncSource: 'live',
      status: row.status ?? 'acked',
      attempts: 0,
      syncedAt: row.syncedAt === undefined ? daysAgo(120) : row.syncedAt,
      createdAt: daysAgo(120),
      updatedAt: daysAgo(120),
    })
  }

  const remainingIds = async (): Promise<string[]> => {
    const rows = (await db('sync-outbox').select('_id')) as Array<{ _id: string }>
    return rows.map(r => r._id).sort()
  }

  beforeEach(async () => {
    db = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    })
    await db.schema.createTable('sync-outbox', table => {
      table.string('_id').primary()
      table.string('service').notNullable()
      table.string('op').notNullable()
      table.string('entityId').notNullable()
      table.text('payload').nullable()
      table.string('occurredAt').notNullable()
      table.string('syncSource').notNullable()
      table.string('status').notNullable().defaultTo('pending')
      table.integer('attempts').notNullable().defaultTo(0)
      table.string('lastAttemptAt').nullable()
      table.string('syncedAt').nullable()
      table.text('lastError').nullable()
      table.string('nextAttemptAt').nullable()
      table.string('terminalAt').nullable()
      table.string('linkedConflictId').nullable()
      table.string('createdAt').notNullable()
      table.string('updatedAt').notNullable()
    })
    // Nur `_id` noetig — die NOT-EXISTS-Subquery der Retention prueft
    // ausschliesslich die Existenz der Event-Row.
    await db.schema.createTable('audit-events', table => {
      table.string('_id').primary()
    })
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('loescht acked Eintraege fremder Services nach Ablauf der Retention', async () => {
    await insertOutboxRow({ _id: 'orders-alt', syncedAt: daysAgo(31) })

    const result = await runOutboxRetention(db, { auditRetentionDays: AUDIT_RETENTION_DAYS, now: NOW })

    assert.strictEqual(result.deletedDefault, 1)
    assert.deepStrictEqual(await remainingIds(), [])
  })

  it('behaelt acked Eintraege fremder Services innerhalb der Retention', async () => {
    await insertOutboxRow({ _id: 'orders-jung', syncedAt: daysAgo(29) })

    const result = await runOutboxRetention(db, { auditRetentionDays: AUDIT_RETENTION_DAYS, now: NOW })

    assert.strictEqual(result.deletedDefault, 0)
    assert.deepStrictEqual(await remainingIds(), ['orders-jung'])
  })

  it('behaelt pending/in-flight/rejected Eintraege unabhaengig vom Alter', async () => {
    await insertOutboxRow({ _id: 'orders-pending', status: 'pending', syncedAt: null })
    await insertOutboxRow({ _id: 'orders-in-flight', status: 'in-flight', syncedAt: daysAgo(200) })
    await insertOutboxRow({ _id: 'orders-rejected', status: 'rejected', syncedAt: daysAgo(200) })

    const result = await runOutboxRetention(db, { auditRetentionDays: AUDIT_RETENTION_DAYS, now: NOW })

    assert.strictEqual(result.deletedDefault, 0)
    assert.strictEqual(result.deletedAuditEvents, 0)
    assert.deepStrictEqual(await remainingIds(), ['orders-in-flight', 'orders-pending', 'orders-rejected'])
  })

  it('behaelt acked audit-events Eintraege bis Audit-Retention + Karenz', async () => {
    // 60 Tage: fuer fremde Services waere die Row bereits weg — der
    // acked-Beweis fuer den Audit-Cleanup muss die volle Audit-Retention
    // (90d) + Karenz ueberleben.
    await insertOutboxRow({ _id: 'audit-karenz', service: 'audit-events', syncedAt: daysAgo(60) })

    const result = await runOutboxRetention(db, { auditRetentionDays: AUDIT_RETENTION_DAYS, now: NOW })

    assert.strictEqual(result.deletedAuditEvents, 0)
    assert.deepStrictEqual(await remainingIds(), ['audit-karenz'])
  })

  it('behaelt acked audit-events Eintraege, solange das Event lokal existiert', async () => {
    await insertOutboxRow({ _id: 'audit-event-da', service: 'audit-events', syncedAt: daysAgo(120) })
    await db('audit-events').insert({ _id: 'entity-audit-event-da' })

    const result = await runOutboxRetention(db, { auditRetentionDays: AUDIT_RETENTION_DAYS, now: NOW })

    assert.strictEqual(result.deletedAuditEvents, 0)
    assert.deepStrictEqual(await remainingIds(), ['audit-event-da'])
  })

  it('loescht acked audit-events Eintraege nach Retention + Karenz, wenn das Event weg ist', async () => {
    // 98 Tage > 90 (Audit-Retention) + 7 (Karenz); Event lokal nicht mehr da.
    await insertOutboxRow({ _id: 'audit-weg', service: 'audit-events', syncedAt: daysAgo(98) })

    const result = await runOutboxRetention(db, { auditRetentionDays: AUDIT_RETENTION_DAYS, now: NOW })

    assert.strictEqual(result.deletedAuditEvents, 1)
    assert.deepStrictEqual(await remainingIds(), [])
  })
})
