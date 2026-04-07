import type { Knex } from 'knex'
import bcrypt from 'bcryptjs'

/**
 * Migrationsskript: Bestehende Klartext-POS-PINs zu bcrypt-Hashes migrieren.
 * Einweg-Migration — Klartext-PINs koennen nicht wiederhergestellt werden.
 */
export async function up(knex: Knex): Promise<void> {
  const users = await knex('users').whereNotNull('posPin').select('_id', 'posPin')

  for (const user of users) {
    // Bereits gehashte PINs ueberspringen (bcrypt-Hashes starten mit $2)
    if (user.posPin.startsWith('$2')) continue

    const hash = bcrypt.hashSync(user.posPin, 6)
    await knex('users').where({ _id: user._id }).update({ posPin: hash })
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Einweg-Migration: Klartext-PINs sind nicht wiederherstellbar
}
