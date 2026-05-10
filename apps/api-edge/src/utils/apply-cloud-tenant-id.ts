import fs from 'node:fs'
import path from 'node:path'
import type { Knex } from 'knex'

import type { Application } from '../declarations'

export interface ApplyCloudTenantIdOptions {
  oldTenantId: string | null
  newTenantId: string
  oldLocationId?: string | null
  newLocationId?: string | null
}

export interface ApplyCloudTenantIdResult {
  backupPath: string | null
  updatedRows: number
  affectedTables: string[]
}

const SYSTEM_TABLES = new Set(['sqlite_master', 'sqlite_sequence', 'knex_migrations', 'knex_migrations_lock'])

/**
 * Tabellen, die beim Restamp uebersprungen werden:
 *
 * - `audit-events`: append-only mit SQLite-Trigger gegen UPDATE/DELETE.
 *   Audit-Eintraege dokumentieren, was unter welcher tenantId/locationId
 *   passiert ist — sie ruckwirkend umzustempeln waere selbst eine Audit-
 *   Verfaelschung. Cloud-side hat ohnehin eigene Audit-Trail; bei Restamp
 *   ist der historische Edge-Audit "lokales Artefakt" und bleibt mit alter ID.
 * - `bootstrap-reports`, `sync-runs`: Diagnose-Telemetrie. Eine Restamp-
 *   Vergangenheit umzuschreiben wuerde die Reproduzierbarkeit der Diagnose
 *   zerstoeren ("vor dem Restamp hatten wir tenantId X" muss historisch wahr
 *   bleiben).
 * - `audit-event-redactions`: gehoert konzeptionell zu audit-events.
 */
const RESTAMP_SKIP_TABLES = new Set([
  'audit-events',
  'audit-event-redactions',
  'bootstrap-reports',
  'sync-runs',
])

const resolveSqliteFilename = (app: Application): string | null => {
  const cfg = app.get('sqlite') as { connection?: { filename?: string } | string } | undefined
  const conn = cfg?.connection
  if (!conn) return null
  if (typeof conn === 'string') return path.resolve(conn)
  if (typeof conn === 'object' && typeof conn.filename === 'string') {
    return path.resolve(conn.filename)
  }
  return null
}

const backupSqliteFile = (filename: string): string => {
  const dir = path.dirname(filename)
  const base = path.basename(filename)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(dir, `${base}.pre-pairing-${stamp}.bak`)
  fs.copyFileSync(filename, backupPath)
  return backupPath
}

const listUserTables = async (knex: Knex): Promise<string[]> => {
  const rows = await knex.raw(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'",
  )
  const list: string[] = []
  for (const row of rows ?? []) {
    if (typeof row?.name === 'string' && !SYSTEM_TABLES.has(row.name)) list.push(row.name)
  }
  return list
}

const tableColumns = async (knex: Knex, table: string): Promise<Set<string>> => {
  const rows = await knex.raw(`PRAGMA table_info("${table}")`)
  const cols = new Set<string>()
  for (const row of rows ?? []) {
    if (typeof row?.name === 'string') cols.add(row.name)
  }
  return cols
}

/**
 * Legt ein Vollbackup der SQLite-DB-Datei an (Pattern `*.pre-pairing-<iso-ts>.bak`).
 * Wird vor destruktiven Bootstrap-Operationen aufgerufen (Pull/Merge), damit der
 * User die ueberschriebenen Edge-Daten zurueckgewinnen kann.
 *
 * Returnt `null`, wenn kein SQLite-File aufloesbar ist (z.B. Test-In-Memory-DB).
 */
export const createPrePairingBackup = async (app: Application): Promise<string | null> => {
  const filename = resolveSqliteFilename(app)
  if (!filename || !fs.existsSync(filename)) return null
  return backupSqliteFile(filename)
}

/**
 * Restampt alle SQLite-Tabellen mit `tenantId`-Spalte auf die Cloud-tenantId.
 * Vor dem Restamping wird ein Vollbackup der DB-Datei angelegt.
 *
 * Wirkt sich nur auf Records mit `tenantId === oldTenantId` aus, damit Edges
 * mit gemischten Mandanten-Daten (sollte praktisch nicht vorkommen) nicht
 * versehentlich umstamping bekommen, das nicht zu ihnen gehoert.
 */
export const applyCloudTenantId = async (
  app: Application,
  opts: ApplyCloudTenantIdOptions,
): Promise<ApplyCloudTenantIdResult> => {
  const knex = app.get('sqliteClient') as Knex | undefined
  if (!knex) throw new Error('SQLite-Client nicht verfuegbar.')

  const filename = resolveSqliteFilename(app)
  let backupPath: string | null = null
  if (filename && fs.existsSync(filename)) {
    backupPath = backupSqliteFile(filename)
  }

  const tables = await listUserTables(knex)

  let updatedRows = 0
  const affected: string[] = []

  // Konvention: Spalten mit Suffix `LocationId` (CamelCase) sind alle Single-
  // Location-FKs (z.B. `activeLocationId`, `assignedLocationId`). Spalten mit
  // Suffix `LocationIds` (Plural) sind JSON-Arrays von Location-Refs.
  // `locationId` selbst ist die kanonische Spalte aus baseSchema.
  const isSingleLocationCol = (col: string): boolean =>
    col === 'locationId' || (col.endsWith('LocationId') && col !== 'locationId')
  const isLocationArrayCol = (col: string): boolean => col.endsWith('LocationIds')

  await knex.transaction(async trx => {
    // Schritt 0: locations-Tabelle umstempeln, BEVOR die FK-Spalten in den
    // anderen Tabellen den Wechsel von oldLocationId → newLocationId vollziehen.
    // Ohne diesen Schritt zeigen alle FKs nach dem Restamp auf eine
    // `locations._id`, die nicht existiert (Geist-Location) — Cloud-gepullte
    // User sind im Edge-Admin-Panel unsichtbar, POS-Login scheitert beim
    // Resolve der Filiale. SQLite-Primary-Key kann nicht direkt umbenannt
    // werden, daher: alte Zeile lesen, neue mit `_id = newLocationId`
    // einfuegen, alte loeschen.
    if (
      opts.oldLocationId !== undefined &&
      opts.newLocationId !== undefined &&
      opts.newLocationId !== null &&
      opts.oldLocationId !== opts.newLocationId &&
      tables.includes('locations')
    ) {
      const oldRow = await trx('locations').where({ _id: opts.oldLocationId }).first()
      if (oldRow) {
        const targetExists = await trx('locations').where({ _id: opts.newLocationId }).first()
        if (!targetExists) {
          await trx('locations').insert({ ...(oldRow as object), _id: opts.newLocationId })
        }
        await trx('locations').where({ _id: opts.oldLocationId }).delete()
        if (!affected.includes('locations')) affected.push('locations')
        updatedRows += 1
      }
    }

    for (const table of tables) {
      // Skip-Tabellen: append-only-Trigger (audit-events) wuerde UPDATE
      // ohnehin verbieten + Diagnose-Tabellen sollen historische IDs behalten.
      if (RESTAMP_SKIP_TABLES.has(table)) continue
      const columns = await tableColumns(trx as unknown as Knex, table)
      if (!columns.has('tenantId')) continue

      // 1. Bulk-Update: tenantId + alle Single-LocationId-Spalten in einem
      // Schritt. Single-Location-FKs werden nur umgestempelt, wenn ihr
      // aktueller Wert exakt `oldLocationId` entspricht — sonst wuerde ein
      // Multi-Location-Edge versehentlich Records aus anderen Filialen treffen.
      const updateData: Record<string, string | null> = { tenantId: opts.newTenantId }

      let query = trx(table).update(updateData)
      if (opts.oldTenantId !== null) {
        query = query.where('tenantId', opts.oldTenantId)
      } else {
        query = query.whereNull('tenantId')
      }
      const count = await query
      if (count > 0) {
        updatedRows += count
        affected.push(table)
      }

      // 2. Pro Single-LocationId-Spalte: separat umstempeln, wenn alte ID matcht.
      if (
        opts.newLocationId !== undefined &&
        opts.oldLocationId !== undefined
      ) {
        for (const col of columns) {
          if (!isSingleLocationCol(col)) continue
          let locQuery = trx(table)
            .update({ [col]: opts.newLocationId })
            .where(col, opts.oldLocationId)
          if (opts.oldTenantId !== null) {
            // Nach dem ersten Update steht `tenantId` schon auf newTenantId —
            // also auf den NEUEN Wert filtern, damit wir die gerade umgestempelten
            // Rows treffen.
            locQuery = locQuery.where('tenantId', opts.newTenantId)
          }
          const locCount = await locQuery
          if (locCount > 0 && !affected.includes(table)) affected.push(table)
        }

        // 3. JSON-Array-Spalten (z.B. `users.allowedLocationIds`): pro Row
        // parsen, ID ersetzen, neu serialisieren. Ineffizient bei vielen Rows,
        // aber semantisch korrekt — SQLite hat keinen JSON-array-update-Operator,
        // der "ersetze X durch Y in Array" sauber abbildet.
        for (const col of columns) {
          if (!isLocationArrayCol(col)) continue
          const rows = await trx(table)
            .select('_id', col)
            .where('tenantId', opts.newTenantId)
          for (const row of rows as Array<Record<string, unknown>>) {
            const raw = row[col]
            if (typeof raw !== 'string' || raw.length === 0) continue
            let parsed: unknown
            try { parsed = JSON.parse(raw) } catch { continue }
            if (!Array.isArray(parsed)) continue
            const before = JSON.stringify(parsed)
            const replaced = (parsed as string[]).map(id =>
              id === opts.oldLocationId ? (opts.newLocationId as string) : id,
            )
            const after = JSON.stringify(replaced)
            if (after === before) continue
            await trx(table)
              .where({ _id: row['_id'] as string })
              .update({ [col]: after })
            if (!affected.includes(table)) affected.push(table)
          }
        }
      }
    }
  })

  return { backupPath, updatedRows, affectedTables: affected }
}
