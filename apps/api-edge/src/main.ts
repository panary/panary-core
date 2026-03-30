import './bootstrap'
import { logger } from './logger'
import fs from 'fs/promises'
import path from 'path'
import { startSetupApp } from './setup-app'
import { constants } from 'fs'
import { UserSystemRole } from '@panary-core/users/domain'

const CONFIG_PATH =
  process.env['PANARY_CONFIG_PATH'] || path.join(process.cwd(), 'data', 'panary.config.json')

// Sentinel-Datei: existiert → Recovery wurde bereits einmal durchgeführt → kein weiterer Versuch
const RECOVERY_FLAG_PATH = path.join(path.dirname(CONFIG_PATH), '.recovery-attempted')

/**
 * Löscht Konfiguration + SQLite-Datenbanken und beendet den Prozess (exit 0).
 * Docker-Restart-Policy startet den Container neu → Setup-Modus.
 *
 * Schutz vor Endlos-Loop: Die Sentinel-Datei .recovery-attempted wird VOR dem Löschen
 * angelegt. Existiert sie beim nächsten Start, wird kein weiterer Auto-Recovery versucht.
 */
async function attemptRecovery(reason: string): Promise<void> {
  try {
    await fs.access(RECOVERY_FLAG_PATH)
    // Sentinel existiert → bereits versucht, kein zweiter Versuch
    logger.error({
      message: 'Bootstrap fehlgeschlagen — Recovery bereits versucht. Manueller Eingriff erforderlich.',
      event: 'bootstrap.recovery_skipped',
      reason,
    })
    return
  } catch {
    // Sentinel existiert nicht → erster Fehler, Recovery durchführen
  }

  logger.warn({
    message: 'Bootstrap fehlgeschlagen. Starte Auto-Recovery: Konfiguration + Datenbank werden gelöscht.',
    event: 'bootstrap.recovery_start',
    reason,
  })

  // Sentinel ZUERST setzen, damit ein Fehler beim Löschen keinen zweiten Versuch auslöst
  await fs.writeFile(RECOVERY_FLAG_PATH, new Date().toISOString(), 'utf-8')

  // Konfigurationsdatei löschen
  await fs.rm(CONFIG_PATH, { force: true })

  // Alle SQLite-Datenbanken im data/-Verzeichnis löschen
  const dataDir = path.dirname(CONFIG_PATH)
  try {
    const files = await fs.readdir(dataDir)
    for (const file of files) {
      if (file.endsWith('.sqlite')) {
        await fs.rm(path.join(dataDir, file), { force: true })
        logger.warn({ message: `Recovery: ${file} gelöscht.`, event: 'bootstrap.recovery_delete_db' })
      }
    }
  } catch {
    // Verzeichnis nicht lesbar — ignorieren, Config wurde bereits gelöscht
  }

  logger.warn({ message: 'Auto-Recovery abgeschlossen. Server wird neu gestartet...', event: 'bootstrap.recovery_complete' })
  // Docker-Restart-Policy übernimmt den Neustart; exit(0) gilt als "sauberer Stop"
  process.exit(0)
}

async function main() {
  try {
    // Check if config file exists
    await fs.access(CONFIG_PATH, constants.F_OK)

    logger.info(`Configuration found at ${CONFIG_PATH}. Starting in PRODUCTION MODE.`)

    // Load configuration
    let config: any = {}
    try {
      const configRaw = await fs.readFile(CONFIG_PATH, 'utf-8')
      config = JSON.parse(configRaw)

      for (const [key, value] of Object.entries(config)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          process.env[key] = String(value)
        }
      }
    } catch (e) {
      logger.error('Error reading configuration file', e)
      throw e
    }

    const { app } = await import('./app.js')

    const port = app.get('port') || 3030
    const host = app.get('host') || 'localhost'

    process.on('unhandledRejection', (reason, p) =>
      logger.error('Unhandled Rejection at: Promise ', p, reason)
    )

    // app.listen() ruft intern app.setup() auf → Migrationen laufen hier
    await app.listen(port)
    logger.info(`Feathers app listening on http://${host}:${port}`)

    // --- DB-Integritätscheck: users-Tabelle muss nach Migration existieren ---
    const knex = app.get('sqliteClient')
    let dbHealthy = false
    try {
      dbHealthy = await knex.schema.hasTable('users')
    } catch {
      dbHealthy = false
    }

    if (!dbHealthy) {
      await attemptRecovery('users-Tabelle fehlt nach Migration — Datenbank nicht initialisiert')
      // Falls Recovery bereits versucht wurde (Sentinel gesetzt), weiter mit Bootstrap (wird scheitern,
      // aber der Server läuft zumindest hoch für manuelle Inspektion)
    }
    // -----------------------------------------------------------------------

    // --- Bootstrapping: Create Admin User if credentials exist in config ---
    const adminEmail = process.env['ADMIN_EMAIL'] || config.adminEmail
    const adminPassword = process.env['ADMIN_PASSWORD'] || config.adminPassword

    if (adminEmail && adminPassword) {
      logger.info('Bootstrapping: Found admin credentials in config. Verifying admin user...')
      try {
        const adminLogin = 'Admin'

        const existingUser = await knex('users').where({ loginname: adminLogin }).first()

        if (!existingUser) {
          logger.info(`Bootstrapping: Creating admin user ${adminLogin}...`)

          const usersService = app.service('users')
          const createdUser = await usersService.create({
            email: adminEmail,
            password: adminPassword,
            role: UserSystemRole.PLATFORM_OWNER,
            loginname: adminLogin,
            firstName: 'Admin',
            lastName: 'User',
            tenantId: null,
            activeLocationId: null,
            allowedLocationIds: [],
            permissions: []
          }, { provider: undefined })

          if (createdUser && createdUser._id) {
            logger.info(`Bootstrapping: Admin user created successfully (ID: ${createdUser._id}).`)
          } else {
            logger.error('Bootstrapping: Admin user create call returned no result — check service hooks!')
          }
        } else {
          logger.info('Bootstrapping: Admin user already exists.')
        }

        // --- Security: Remove password from config file ---
        if (config.adminPassword) {
          logger.info('Security: Removing plain-text password from configuration file...')
          delete config.adminPassword
          await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
          logger.info('Security: Configuration file sanitized.')
        }
      } catch (err: any) {
        logger.error('Bootstrapping: Failed to create admin user.', err)
        // Bei SQLITE_ERROR (Tabelle fehlt trotz Integritätscheck) Recovery auslösen
        if (err?.code === 'SQLITE_ERROR') {
          await attemptRecovery(`Admin-Bootstrap SQLITE_ERROR: ${err.message}`)
        }
      }
    }
    // -----------------------------------------------------------------------

    // --- Bootstrapping: Auto-Geschäftstag für Edge-Server ---
    try {
      const { autoEnsureBusinessDay } = await import('./bootstrap-business-day.js')
      await autoEnsureBusinessDay(app)
    } catch (err) {
      logger.error('AutoBusinessDay: Geschäftstag konnte nicht erstellt werden.', err)
    }
    // -----------------------------------------------------------------------

    // --- Auto-Start Print-Server ---
    try {
      const { autoStartPrintServer } = await import('./print-server/index.js')
      await autoStartPrintServer(app)
    } catch (err) {
      logger.error('Print-Server: Auto-Start fehlgeschlagen.', err)
    }
    // -----------------------------------------------------------------------
  } catch (error) {
    logger.error(
      `Configuration check failed or file missing at ${CONFIG_PATH}. Starting in SETUP MODE.`,
      error
    )
    await startSetupApp(3030)
  }
}

main().catch(err => {
  logger.error('Fatal error during startup', err)
  process.exit(1)
})
