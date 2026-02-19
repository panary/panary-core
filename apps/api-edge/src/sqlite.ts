// For more information about this file see https://dove.feathersjs.com/guides/cli/databases.html
import type { Knex } from 'knex'
import knex from 'knex'
import type { Application } from './declarations'
import path from 'path'
import fs from 'fs'

declare module './declarations' {
  interface Configuration {
    sqliteClient: Knex
  }
}

export const sqlite = (app: Application) => {
  const config = app.get('sqlite')

  if (!config) {
    console.warn('WARNING: No SQLite configuration found in app config!')
    console.warn('   Skipping Database initialization.')
    return // Einfach abbrechen, statt abzustürzen
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
    console.warn('WARNING: No migrations directory found. Checked:', candidates)
    console.warn('   Skipping migrations.')
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
      async (_context: any) => {
        if (migrationDir) {
          try {
            await db.migrate.latest()
            console.log(`Migrations from ${migrationDir} applied successfully.`)
          } catch (err) {
            console.error(`Failed to run migrations from ${migrationDir}!`, err)
          }
        }
      }
    ]
  })
}
