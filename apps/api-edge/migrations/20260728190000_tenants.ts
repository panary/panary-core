// Migration: tenants-Tabelle (Edge-Replica der projizierten Tenant-Stammdaten).
//
// OoS-Welle E Item 4: Die Cloud synct das Tenant-Doc als Master-Data zum Edge
// (Receipt-Header/Footer, Logo fuer Offline-Bon-Druck, Localization, kuratierte
// TSE-Referenzen) — projiziert via projectTenantForEdge (panary-cloud). Bisher
// fehlte am Edge der tenants-Service samt Tabelle; jeder Pull-Zyklus lief mit
// "Can not find service 'tenants'" ins Leere (Befund Testkunde 2026-07-28).
//
// BEWUSST keine tenantId-/locationId-Spalten: das `_id` IST der Tenant.
// JSON-Spalten (branding/localization/legalEntity/tse) als TEXT —
// Serialisierung via getJsonFieldHooks im Service. Kein Index noetig: die
// Tabelle haelt genau eine Row (Single-Tenant-Edge), der PK reicht.

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('tenants')
  if (!exists) {
    await knex.schema.createTable('tenants', table => {
      table.string('_id').primary()
      table.string('name').notNullable()
      table.string('status').nullable()
      table.string('region').nullable()
      table.text('branding').nullable()
      table.text('localization').nullable()
      table.text('legalEntity').nullable()
      table.text('tse').nullable()
      table.integer('syncVersion').nullable()
      table.string('createdAt').nullable()
      table.string('updatedAt').nullable()
    })
  }

  // Cursor-Reset (analog 20260728150000/-170000): Die bisherigen tenants-Pulls
  // sind NICHT hart fehlgeschlagen — applyPulledRecords faengt das fehlende
  // Service pro Record ab (REJECTED) und der Pull galt als PARTIAL → der
  // Cursor wurde trotzdem weiterbewegt. Ohne Reset kaeme der Tenant-Record im
  // Delta-Pull nie wieder; der Reset erzwingt einen vollen, idempotenten Re-Pull.
  const hasCursorTable = await knex.schema.hasTable('sync-cursor')
  if (!hasCursorTable) return
  await knex('sync-cursor').where('_id', 'cloud:tenants').delete()
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tenants')
}
