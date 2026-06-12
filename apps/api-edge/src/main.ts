import './bootstrap'
import { logger } from '@panary/shared-backend'
import fs from 'fs/promises'
import path from 'path'
import { startSetupApp } from './setup-app'
import { APP_VERSION } from './version'
import { constants } from 'fs'
import { UserSystemRole } from '@panary/users/domain'
import { uuidv7 } from 'uuidv7'

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
        const adminLogin = process.env['ADMIN_LOGIN'] || config.adminLogin || 'admin'

        // E-Mail ist der Login-Identifier — Existenz-Check entsprechend per email
        // (nicht mehr loginname, das nur noch Anzeige-Handle ist).
        const existingUser = await knex('users').where({ email: adminEmail }).first()

        if (!existingUser) {
          logger.info(`Bootstrapping: Creating admin user ${adminLogin}...`)

          const usersService = app.service('users')
          // SICHERHEIT: PLATFORM_OWNER ist eine Cloud-Identity (Panary-intern,
          // Bypass aller Tenant-Filter). Der erste Edge-Admin ist fachlich der
          // Tenant-Inhaber — TENANT_OWNER reicht fuer alle lokalen Edge-Aktionen
          // und bekommt beim Sync nicht versehentlich Cross-Tenant-Zugriff in
          // der Cloud. Cloud-Sync blockt zusaetzlich `platform:*`-Rollen.
          const createdUser = await usersService.create({
            email: adminEmail,
            password: adminPassword,
            role: UserSystemRole.TENANT_OWNER,
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

    // --- Bootstrapping: Location + Tenant erstellen (falls noch keine existiert) ---
    try {
      const locationCount = await knex('locations').count('* as cnt').first()
      if (!locationCount || Number(locationCount.cnt) === 0) {
        const tenantId = uuidv7()
        const locationId = uuidv7()
        const locationName = config.locationName || config.shopName || 'Hauptstandort'
        const organizationName = config.shopName || locationName
        const now = new Date().toISOString()

        logger.info({
          message: `Bootstrapping: Erstelle Location "${locationName}" (Org: "${organizationName}") mit tenantId ${tenantId}`,
          event: 'bootstrap.location_create',
          tenantId,
          locationId,
          locationName,
          organizationName,
        })

        // Direkt via Knex einfuegen — umgeht Schema-Validierung (address ist beim
        // Bootstrap noch nicht vorhanden, kann spaeter im Admin-Panel ergaenzt werden)
        await knex('locations').insert({
          _id: locationId,
          tenantId,
          name: locationName,
          organizationName,
          status: 'ACTIVE',
          settings: JSON.stringify({}),
          createdAt: now,
          updatedAt: now,
        })

        // Admin-User dem Tenant zuordnen.
        // Auch alte PLATFORM_OWNER-User (vor dem Security-Downgrade) werden
        // erkannt — sie bekommen den Tenant zugewiesen und beim naechsten
        // Edge-Boot per Migration auf TENANT_OWNER umgestellt.
        const adminUser = await knex('users')
          .whereIn('role', [UserSystemRole.TENANT_OWNER, UserSystemRole.PLATFORM_OWNER])
          .whereNull('tenantId')
          .first()

        if (adminUser) {
          await knex('users').where({ _id: adminUser._id }).update({
            tenantId,
            activeLocationId: locationId,
            allowedLocationIds: JSON.stringify([locationId]),
          })

          logger.info({
            message: `Bootstrapping: Admin-User ${adminUser.loginname} dem Tenant zugeordnet`,
            event: 'bootstrap.admin_tenant_assigned',
            userId: adminUser._id,
            tenantId,
            locationId,
          })
        }
      }
    } catch (err: any) {
      logger.error('Bootstrapping: Location-Erstellung fehlgeschlagen.', err)
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

    // --- Bootstrap-Resume: nach Edge-Restart abgebrochene Bootstraps fortsetzen (M7.8) ---
    try {
      const { resumePendingBootstraps } = await import('./workers/cloud-bootstrap-runner.worker.js')
      await resumePendingBootstraps(app)
    } catch (err) {
      logger.error('Bootstrap-Resume: Wiederaufnahme fehlgeschlagen.', err)
    }
    // -----------------------------------------------------------------------

    // --- Cloud-Sync-Scheduler: Push/Pull/Heartbeat in 4 Modi (M7.4) ---
    try {
      const { startCloudSyncSchedulerWorker } = await import('./workers/cloud-sync-scheduler.worker.js')
      await startCloudSyncSchedulerWorker(app)
    } catch (err) {
      logger.error('Cloud-Sync-Scheduler: Worker konnte nicht gestartet werden.', err)
    }
    // -----------------------------------------------------------------------

    // --- Business-Days-Pull-Worker (Cloud-Managed Hybrid, siehe ADR) ---
    // Pollt alle 5s im CONNECTED-Modus die Cloud-business-days +
    // location.currentBusinessDay. Im DISCONNECTED-Modus pausiert er
    // (rotateBusinessDay() laeuft dann im Standalone-Pfad).
    try {
      const { startBusinessDaysPullWorker } = await import(
        './workers/cloud-pull-business-days.worker.js'
      )
      await startBusinessDaysPullWorker(app)
    } catch (err) {
      logger.error('BusinessDays-Pull-Worker konnte nicht gestartet werden.', err)
    }
    // -----------------------------------------------------------------------

    // --- Cloud-Realtime-Worker (Socket.IO-Push, Trigger-Hybrid) ---
    // Baut OUTBOUND eine Socket.IO-Verbindung zur Cloud auf und empfängt
    // Push-Trigger (changed/force-sync/revoked). Auf `changed` läuft derselbe
    // Pull-Pfad wie der 5s-Poll, nur ~instant. Der Pull-Worker bleibt als
    // Fallback aktiv (adaptive Kadenz via cloud-realtime-state).
    try {
      const { startCloudRealtimeWorker } = await import('./workers/cloud-realtime.worker.js')
      await startCloudRealtimeWorker(app)
    } catch (err) {
      logger.error('Cloud-Realtime-Worker konnte nicht gestartet werden.', err)
    }
    // -----------------------------------------------------------------------

    // --- Auto-Repair-Hook fuer historisch inkonsistente Edge-DBs ---
    // Heilt einmalig: User mit activeLocationId, die nicht in locations._id
    // existieren (Geist-Location aus altem Pairing-Bug). Idempotent — bei
    // konsistenter DB tut der Hook nichts.
    try {
      const { runLocationRestampRepair } = await import('./workers/repair-location-restamp.worker.js')
      await runLocationRestampRepair(app)
    } catch (err) {
      logger.error('Auto-Repair-Hook fehlgeschlagen.', err)
    }
    // -----------------------------------------------------------------------

    // --- Audit-Cleanup-Worker: nightly 90d-Retention (Phase 2) ---
    try {
      const { startAuditCleanupWorker } = await import('./workers/audit-cleanup.worker.js')
      startAuditCleanupWorker(app)
    } catch (err) {
      logger.error('Audit-Cleanup-Worker: Start fehlgeschlagen.', err)
    }
    // -----------------------------------------------------------------------

    // --- Sync-Runs-Cleanup-Worker: nightly 30d-Retention der Telemetrie ---
    try {
      const { startSyncRunsCleanupWorker } = await import('./workers/sync-runs-cleanup.worker.js')
      startSyncRunsCleanupWorker(app)
    } catch (err) {
      logger.error('Sync-Runs-Cleanup-Worker: Start fehlgeschlagen.', err)
    }
    // -----------------------------------------------------------------------

    // --- Closing-Status-Refresh-Worker: alle 30s offene Closings refreshen ---
    try {
      const { startClosingStatusRefreshWorker } = await import(
        './workers/closing-status-refresh.worker.js'
      )
      startClosingStatusRefreshWorker(app)
    } catch (err) {
      logger.error('Closing-Status-Refresh-Worker: Start fehlgeschlagen.', err)
    }
    // -----------------------------------------------------------------------

    // --- Business-Day-Rotation-Worker: nightly Auto-Rotation im Standalone-Modus ---
    // Rotiert den Geschaeftstag zur konfigurierten lokalen Stunde, ohne auf
    // Server-Neustart oder den ersten Order des neuen Tages zu warten.
    try {
      const { startBusinessDayRotationWorker } = await import(
        './workers/business-day-rotation.worker.js'
      )
      startBusinessDayRotationWorker(app)
    } catch (err) {
      logger.error('Business-Day-Rotation-Worker: Start fehlgeschlagen.', err)
    }
    // -----------------------------------------------------------------------

    // --- mDNS-Advertising: Edge im LAN als _panary._tcp auffindbar machen ---
    // Ermoeglicht dem POS-Setup-Wizard, den Hub ohne manuelle IP-Eingabe zu
    // entdecken. Best-effort — ein Fehlschlag blockiert den Edge nicht.
    try {
      const { startMdnsAdvertising } = await import('./mdns-advertiser.js')
      const firstLocation = await knex('locations')
        .select('_id', 'organizationName', 'name')
        .first()
      startMdnsAdvertising({
        port,
        version: APP_VERSION,
        organizationName: firstLocation?.organizationName || firstLocation?.name,
        setupComplete: !!firstLocation,
        systemMode: app.get('system')?.mode || 'standalone',
        locationId: firstLocation?._id,
      })
    } catch (err) {
      logger.error('mDNS-Advertising: Start fehlgeschlagen.', err)
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
