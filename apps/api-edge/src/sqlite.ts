// For more information about this file see https://dove.feathersjs.com/guides/cli/databases.html
import type { Knex } from 'knex'
import knex from 'knex'
import type { Application } from './declarations'
import path from 'path'
import fs from 'fs'
import { logger } from './logger'

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
  if (typeof config.connection === 'string') {
    config.connection = path.resolve(process.cwd(), config.connection)
  }

  // --- Start: Migration Source Path Fix ---
  let migrationDir = ''

  // Priority list of potential migration directories
  const candidates = [
    path.join(__dirname, '../migrations'),           // dev: src/ -> ../migrations/
    path.join(__dirname, 'migrations'),              // bundled production: sibling
    path.join(__dirname, '../../../../migrations'),   // dist structure
    path.join(process.cwd(), 'apps/api-edge/migrations'), // workspace root (nx serve)
    path.join(process.cwd(), 'migrations'),          // standalone fallback
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
  dbConfig.migrations.loadExtensions = ['.ts', '.js']

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
