import type { Knex } from 'knex'
import { createHash } from 'node:crypto'

/**
 * Migrationsskript: Bestehende Klartext-API-Keys zu SHA-256-Hashes migrieren.
 * Fuegt apikeyPrefix-Spalte hinzu und befuellt sie.
 * Einweg-Migration — Klartext-Keys koennen nicht wiederhergestellt werden.
 */
export async function up(knex: Knex): Promise<void> {
  // 1. apikeyPrefix-Spalte anlegen (falls noch nicht vorhanden)
  const hasColumn = await knex.schema.hasColumn('apikeys', 'apikeyPrefix')
  if (!hasColumn) {
    await knex.schema.alterTable('apikeys', table => {
      table.string('apikeyPrefix').nullable()
    })
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_apikeys_prefix ON apikeys (apikeyPrefix)')
  }

  // 2. Bestehende Klartext-Keys hashen
  const apikeys = await knex('apikeys').whereNotNull('apikey').select('_id', 'apikey')

  for (const key of apikeys) {
    // SHA-256-Hashes sind 64 Hex-Zeichen — bereits gehashte Keys ueberspringen
    if (key.apikey.length === 64 && /^[0-9a-f]+$/.test(key.apikey)) continue

    const prefix = key.apikey.slice(0, 8)
    const hash = createHash('sha256').update(key.apikey).digest('hex')
    await knex('apikeys').where({ _id: key._id }).update({
      apikey: hash,
      apikeyPrefix: prefix,
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  // Einweg-Migration: Klartext-Keys sind nicht wiederherstellbar
  // Prefix-Spalte kann sicher entfernt werden
  const hasColumn = await knex.schema.hasColumn('apikeys', 'apikeyPrefix')
  if (hasColumn) {
    await knex.schema.alterTable('apikeys', table => {
      table.dropColumn('apikeyPrefix')
    })
  }
}
