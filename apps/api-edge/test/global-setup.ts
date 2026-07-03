import { mkdirSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import knexFactory from 'knex'

// knex laedt Migrationsdateien zur Laufzeit per require vom Dateisystem —
// fuer die .ts-Migrationen braucht der Hauptprozess denselben Loader wie
// die App (sqlite.ts): @swc-node/register haengt sich an Node's require-Hook.
const nodeRequire = createRequire(__filename)
try {
  nodeRequire('@swc-node/register')
} catch {
  // bereits registriert oder nicht verfuegbar (Produktion mit kompiliertem JS)
}

// Läuft einmal im Vitest-Hauptprozess, BEVOR die Worker starten. Ohne diesen
// Schritt rennen alle Testdateien beim Erst-Boot (frisches data/, z. B. im CI)
// parallel in die Erst-Migration derselben SQLite-Datei — knex' Migrations-Lock
// existiert auf einer leeren DB noch nicht ("table knex_migrations already
// exists"-Race). Nach dem Warmup sind die Worker-Migrationen idempotente No-ops.
// Pfade bewusst identisch zu vitest.config.mts (test.env.SQLITE_PATH) gebaut —
// test.env gilt nur in den Workern, nicht in diesem Hauptprozess.
export default async function globalSetup(): Promise<void> {
  const dataDir = join(__dirname, '..', 'data')
  mkdirSync(dataDir, { recursive: true })

  const db = knexFactory({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: join(dataDir, 'api-edge.test.sqlite') },
  })
  try {
    await db.migrate.latest({
      directory: join(__dirname, '..', 'migrations'),
      loadExtensions: ['.ts', '.js'],
    })
  } finally {
    await db.destroy()
  }
}
