// Migration: fehlende locations-Spalten nachziehen + Location-Pull-Cursors reset.
//
// Hintergrund (Standort-Settings-Sync, Befund Testkunde 2026-07-28): Das
// Domain-Schema kennt `brandId`/`handle` (Phase 6 BRAND-01/03) sowie
// `locale`/`defaultCurrency` — die Edge-SQLite-Tabelle hat diese Spalten aber
// nie per Migration bekommen. Der Cloud→Edge-Pull-Apply patcht die Location
// mit dem KOMPLETTEN Cloud-Record → Knex-UPDATE scheitert mit
// "no such column: brandId" und die Standort-Settings (Drucker/Pager/Tische/
// Oeffnungszeiten) kommen weiterhin nie an. Solange die Validierung den
// CREATE-Pfad ablehnte (Fix v26.7.35), war dieser Folgefehler unsichtbar.
//
// hasColumn-Guards machen die Migration idempotent (defensiv gegen manuell
// reparierte Edge-DBs).

import type { Knex } from 'knex'

const NEW_COLUMNS = ['brandId', 'handle', 'locale', 'defaultCurrency'] as const

export async function up(knex: Knex): Promise<void> {
  for (const column of NEW_COLUMNS) {
    const exists = await knex.schema.hasColumn('locations', column)
    if (!exists) {
      await knex.schema.alterTable('locations', table => {
        table.string(column).nullable()
      })
    }
  }

  // Cursor-Reset (analog 20260728150000): Die bis hierhin fehlgeschlagenen
  // Location-/Exception-Pulls haben den Cursor trotzdem weiterbewegt — ohne
  // Reset kaemen die verpassten Records im Delta-Pull nie wieder. Der Reset
  // erzwingt beim naechsten Sync-Zyklus einen vollen, idempotenten Re-Pull.
  const hasTable = await knex.schema.hasTable('sync-cursor')
  if (!hasTable) return
  await knex('sync-cursor').whereIn('_id', ['cloud:locations', 'cloud:opening-hour-exceptions']).delete()
}

export async function down(): Promise<void> {
  // Nicht umkehrbar noetig: Spalten sind additiv-nullable, der Cursor-Reset
  // ist selbstheilend (Re-Pull ist idempotent).
}
