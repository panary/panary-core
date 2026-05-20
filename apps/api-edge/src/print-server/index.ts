import type { Application } from '../declarations'
import { createPrintServerMiddleware } from './print-server.router'
import { printServerManager } from './print-server.manager'
import { logger } from '@panary/shared-backend'

/**
 * Registriert die Print-Server Koa-Middleware in der Feathers-App.
 */
export const configurePrintServer = (app: Application) => {
  const middleware = createPrintServerMiddleware(app)
  app.use(middleware)

  logger.info({ message: 'Print-Server Endpoints registriert unter /print-server/*', event: 'print-server.configured' })
}

/**
 * Auto-Start des Print-Servers nach App-Boot.
 * Liest printServerEnabled aus den Location-Settings.
 */
export async function autoStartPrintServer(app: Application): Promise<void> {
  try {
    const knex = app.get('sqliteClient')
    const location = await knex('locations').first()

    if (!location) {
      logger.info({ message: 'Print-Server Auto-Start übersprungen: Kein Standort konfiguriert', event: 'print-server.auto_skip' })
      return
    }

    let settings: Record<string, unknown> | undefined
    if (typeof location.settings === 'string') {
      settings = JSON.parse(location.settings)
    } else {
      settings = location.settings as Record<string, unknown>
    }

    const printSettings = settings?.printSettings as Record<string, unknown> | undefined
    const enabled = printSettings?.printServerEnabled ?? true

    if (!enabled) {
      logger.info({ message: 'Print-Server Auto-Start übersprungen: printServerEnabled=false', event: 'print-server.auto_disabled' })
      return
    }

    const printers = (printSettings?.printers as Array<Record<string, unknown>>) ?? []
    await printServerManager.start(printers as any)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ message: `Print-Server Auto-Start fehlgeschlagen: ${message}`, event: 'print-server.auto_error' })
  }
}

export { printServerManager }
