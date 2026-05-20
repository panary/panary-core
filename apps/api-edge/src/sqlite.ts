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

  // Register setup hook so migrations run BEFORE services are accessed
  // Feathers awaits setup hooks when app.listen() or app.setup() is called
  app.hooks({
    setup: [
      async (_context: any, next: any) => {
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
