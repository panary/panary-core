// For more information about this file see https://dove.feathersjs.com/guides/cli/databases.html
import type { Knex } from 'knex'
import knex from 'knex'
import type { Application } from './declarations'
import path from 'path'
import fs from 'fs'
import { logger } from '@panary/shared-backend'

declare module './declarations' {
  interface Configuration {
    sqliteClient: Knex
  }
}

export const sqlite = (app: Application) => {
  const config = app.get('sqlite')

  if (!config) {
    logger.warn({ message: 'No SQLite configuration found — skipping DB init', event: 'sqlite.no_config' })
    return
  }

  // Connection-Pfad absolut auflösen (relativ zu process.cwd() = Workspace-Root bei nx serve)
  // better-sqlite3 erwartet { filename: '...' }, Knex-Typen kennen dieses Feld nicht
  const conn = config.connection as any
  if (typeof conn === 'string') {
    ;(config as any).connection = { filename: path.resolve(process.cwd(), conn) }
  } else if (conn?.filename) {
    conn.filename = path.resolve(process.cwd(), conn.filename)
  }

  // --- Start: Migration Source Path Fix ---
  let migrationDir = ''

  // Priority list of potential migration directories
  // Hinweis: esbuild (bundle:false) erhält die volle Quellstruktur, daher ist __dirname
  // in Docker /app/dist/apps/api-edge/apps/api-edge/src/ — drei Ebenen über die dist-Root.
  const candidates = [
    path.join(process.cwd(), 'dist/apps/api-edge/migrations'), // Docker: /app/dist/apps/api-edge/migrations/
    path.join(__dirname, '../../../migrations'),                // esbuild-Struktur: src/ -> dist-Root/migrations/
    path.join(__dirname, '../migrations'),                      // dev: src/ -> ../migrations/
    path.join(__dirname, 'migrations'),                         // gebündelte Produktion: Geschwister
    path.join(__dirname, '../../../../migrations'),              // ältere dist-Struktur
    path.join(process.cwd(), 'apps/api-edge/migrations'),      // Workspace-Root (nx serve)
    path.join(process.cwd(), 'migrations'),                     // Standalone-Fallback
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      migrationDir = candidate
      break
    }
  }

  if (!migrationDir) {
    logger.warn({
      message: 'No migrations directory found — skipping migrations',
      event: 'sqlite.no_migrations',
      checkedLocations: candidates,
    })
  }

  // Cast config to any to handle migration property
  const dbConfig: any = config
  if (!dbConfig.migrations) {
    dbConfig.migrations = {}
  }
  dbConfig.migrations.directory = migrationDir
  // In Docker sind Migrationen zu .js kompiliert; lokal (nx serve) werden .ts via @swc-node/register geladen
  dbConfig.migrations.loadExtensions = process.env['NODE_ENV'] === 'production' ? ['.js'] : ['.ts', '.js']

  // Ensure TypeScript migrations can be loaded at runtime
  try {
    require('@swc-node/register')
  } catch {
    // Already registered or not available (production with compiled JS)
  }
  // --- End: Migration Source Path Fix ---

  const db = knex(dbConfig!)

  app.set('sqliteClient', db)

  // PRAGMA-Setup. Standardwerte von SQLite (journal_mode=DELETE,
  // synchronous=FULL, busy_timeout=0) sind fuer Single-Writer-Hobby-Datenbanken
  // gedacht und kollabieren in der Realitaet eines POS-Betriebs:
  //
  //   - DELETE-Journal + FULL-Sync = pro COMMIT mehrere fsync()-Calls. Auf
  //     einem Sunmi D3 mit eMMC ergibt das ~50-80ms Latenz pro Commit.
  //   - busy_timeout=0 = ein paralleler Writer (cloud-sync-scheduler /
  //     audit-cleanup-worker / POS-Order-Save) wird sofort mit SQLITE_BUSY
  //     abgewiesen, statt zu warten.
  //
  // WAL + NORMAL-Sync + 5s busy_timeout sind der Standard fuer Server-
  // /Edge-Workloads mit gelegentlich parallelen Writern (siehe
  // https://www.sqlite.org/wal.html). Power-safe bleibt durch NORMAL erhalten
  // (kein Korruptions-Risiko bei Stromausfall, nur jeweils die letzte
  // Transaktion kann verlorengehen — akzeptabel, weil Outbox-Sync ohnehin
  // re-enqueued).
  //
  // mmap_size + cache_size dienen dem Read-heavy POS-Pfad (Produktliste,
  // Bestellliste, Tagesabschluss).
  //
  // Hinweis fuer Backup-Skripte: WAL erzeugt zusaetzlich `*.sqlite-wal` und
  // `*.sqlite-shm`. Backup-Skripte muessen diese Dateien mitziehen, sonst
  // gehen die letzten Transaktionen verloren — siehe Coolify-Backup-Doku.
  const setupPragmas = async () => {
    const pragmas: ReadonlyArray<readonly [string, string]> = [
      ['journal_mode', 'WAL'],
      ['synchronous', 'NORMAL'],
      ['busy_timeout', '5000'],
      ['foreign_keys', 'ON'],
      ['cache_size', '-32000'],         // 32 MB Page-Cache (Default: 2 MB)
      ['temp_store', 'MEMORY'],
      ['mmap_size', '268435456'],       // 256 MB mmap
      ['wal_autocheckpoint', '1000'],   // Checkpoint nach 1000 Pages
    ]
    for (const [key, value] of pragmas) {
      try {
        await db.raw(`PRAGMA ${key} = ${value}`)
      } catch (err) {
        logger.warn({
          message: 'SQLite-Pragma konnte nicht gesetzt werden',
          event: 'sqlite.pragma_failed',
          pragma: key,
          value,
          error: String(err),
        })
      }
    }
    // Modus zur Verifikation einmal nachlesen.
    try {
      const journalRow = await db.raw('PRAGMA journal_mode')
      const syncRow = await db.raw('PRAGMA synchronous')
      logger.info({
        message: 'SQLite-Pragmas gesetzt',
        event: 'sqlite.pragmas',
        journalMode: Array.isArray(journalRow) ? journalRow[0]?.journal_mode : journalRow,
        synchronous: Array.isArray(syncRow) ? syncRow[0]?.synchronous : syncRow,
      })
    } catch {
      // Verifikation darf nicht fehlschlagen-relevant sein.
    }
  }

  // Register setup hook so migrations run BEFORE services are accessed
  // Feathers awaits setup hooks when app.listen() or app.setup() is called
  app.hooks({
    setup: [
      async (_context: any, next: any) => {
        // Pragmas VOR den Migrationen setzen — die Migrationen sollen schon
        // im WAL-Modus laufen, damit kein DELETE-Journal-Artefakt zurueckbleibt.
        await setupPragmas()
        if (migrationDir) {
          try {
            await db.migrate.latest()
            logger.info({ message: 'Migrations applied successfully', event: 'sqlite.migrations', migrationDir })
          } catch (err) {
            logger.error({ message: 'Failed to run migrations', event: 'sqlite.migrations_error', migrationDir, error: String(err) })
          }
        }
        await next()
      }
    ]
  })
}
