import type { Middleware } from '@feathersjs/koa'
import { AppAction } from '@panary-core/users/domain'
import type { Application } from '../declarations'
import { printServerAuth, printServerAuthorize } from './auth.middleware'
import { printServerManager } from './print-server.manager'
import type { PrinterConfig } from './print-job.builder'
import { renderOrderReceipt } from './order-receipt.renderer'
import { sendToNetworkPrinter } from './escpos.adapter'
import { logger } from '@panary-core/shared-backend'

const PREFIX = '/print-server'

type RouteHandler = (ctx: any, app: Application) => Promise<void>

interface Route {
  method: 'GET' | 'POST'
  path: string
  requiredAction: (typeof AppAction)[keyof typeof AppAction]
  handler: RouteHandler
}

const routes: Route[] = [
  {
    method: 'GET',
    path: '/status',
    requiredAction: AppAction.READ,
    handler: async ctx => {
      ctx.body = printServerManager.getStatus()
    },
  },
  {
    method: 'POST',
    path: '/start',
    requiredAction: AppAction.MANAGE,
    handler: async (ctx, app) => {
      try {
        const printers = await loadPrintersFromLocation(app, ctx.state.user)
        await printServerManager.start(printers)
        ctx.body = { success: true, status: printServerManager.getStatus() }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error({ message: `Print-Server Start fehlgeschlagen: ${message}`, event: 'print-server.start_error' })
        ctx.status = 500
        ctx.body = { success: false, error: message }
      }
    },
  },
  {
    method: 'POST',
    path: '/stop',
    requiredAction: AppAction.MANAGE,
    handler: async ctx => {
      await printServerManager.stop()
      ctx.body = { success: true, status: printServerManager.getStatus() }
    },
  },
  {
    method: 'POST',
    path: '/restart',
    requiredAction: AppAction.MANAGE,
    handler: async (ctx, app) => {
      try {
        const printers = await loadPrintersFromLocation(app, ctx.state.user)
        await printServerManager.restart(printers)
        ctx.body = { success: true, status: printServerManager.getStatus() }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        ctx.status = 500
        ctx.body = { success: false, error: message }
      }
    },
  },
  {
    method: 'POST',
    path: '/print',
    requiredAction: AppAction.CREATE,
    handler: async ctx => {
      const job = ctx.request.body
      if (!job || !job.document || !Array.isArray(job.document)) {
        ctx.status = 400
        ctx.body = { error: 'Ungültiger Druckauftrag: document-Array erforderlich' }
        return
      }

      const result = await printServerManager.print(job)
      ctx.body = result
    },
  },
  {
    method: 'POST',
    path: '/test-print',
    requiredAction: AppAction.UPDATE,
    handler: async ctx => {
      const { printerId } = ctx.request.body as { printerId?: string }
      if (!printerId) {
        ctx.status = 400
        ctx.body = { error: 'printerId erforderlich' }
        return
      }

      const result = await printServerManager.testPrint(printerId)
      ctx.body = result
    },
  },
  {
    method: 'POST',
    path: '/print-order',
    requiredAction: AppAction.CREATE,
    handler: async (ctx, app) => {
      const { orderId, printerIds, deviceName } = ctx.request.body as {
        orderId?: string
        printerIds?: string[]
        deviceName?: string
      }
      if (!orderId) {
        ctx.status = 400
        ctx.body = { error: 'orderId erforderlich' }
        return
      }

      try {
        // Order aus DB laden
        const order = await app.service('orders').get(orderId, { provider: undefined })
        if (!order) {
          ctx.status = 404
          ctx.body = { error: 'Bestellung nicht gefunden' }
          return
        }

        // Location laden (für Filialangaben + Settings)
        const location = await loadLocationForUser(app, ctx.state.user)

        // Drucker bestimmen
        const settings = (location.settings as any)?.printSettings
        let printers: PrinterConfig[] = (settings?.printers ?? []).filter((p: any) => p.active && p.type === 'ip')
        if (printerIds?.length) {
          printers = printers.filter(p => printerIds.includes(p.pid))
        }

        if (printers.length === 0) {
          ctx.body = { success: false, results: [{ printerId: '', printerName: '', success: false, error: 'Keine aktiven IP-Drucker' }] }
          return
        }

        // Papierbreite vom ersten Drucker
        const paperWidth = (printers[0] as any).paperWidth || '80mm'

        // Backend-Rendering: Order → ESC/POS Buffer
        const buffer = renderOrderReceipt(order, location, { paperWidth }, deviceName)

        // An alle Ziel-Drucker senden
        const results: any[] = []
        for (const printer of printers) {
          try {
            await sendToNetworkPrinter(printer.ip!, printer.port ?? 9100, buffer)
            results.push({ printerId: printer.pid, printerName: printer.name, success: true })
            logger.info({ message: `Bestellbon an ${printer.name} gesendet`, event: 'print.order_success', printer: printer.name, orderId })
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            results.push({ printerId: printer.pid, printerName: printer.name, success: false, error: msg })
            logger.error({ message: `Bestellbon-Fehler an ${printer.name}: ${msg}`, event: 'print.order_error', printer: printer.name, orderId })
          }
        }

        ctx.body = { success: results.every(r => r.success), results }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error({ message: `print-order fehlgeschlagen: ${message}`, event: 'print-server.print_order_error', orderId })
        ctx.status = 500
        ctx.body = { success: false, error: message }
      }
    },
  },
]

/**
 * Erstellt eine einzelne Koa-Middleware, die alle Print-Server-Endpoints bedient.
 * Kein @koa/router nötig — Pattern-Matching direkt auf ctx.path + ctx.method.
 */
export function createPrintServerMiddleware(app: Application): Middleware {
  const authMiddleware = printServerAuth(app)

  return async (ctx, next) => {
    if (!ctx.path.startsWith(PREFIX)) {
      return next()
    }

    const subPath = ctx.path.slice(PREFIX.length) || '/'
    const route = routes.find(r => r.method === ctx.method && r.path === subPath)

    if (!route) {
      ctx.status = 404
      ctx.body = { error: `Unbekannter Endpoint: ${ctx.method} ${ctx.path}` }
      return
    }

    // Authentifizierung
    await authMiddleware(ctx, async () => {
      // Autorisierung
      const authorizeMiddleware = printServerAuthorize(route.requiredAction)
      await authorizeMiddleware(ctx, async () => {
        // Handler ausführen
        await route.handler(ctx, app)
      })
    })
  }
}

/**
 * Lädt die Location des Users. Fällt auf die erste Location zurück
 * (Edge-Server hat typischerweise nur eine Location).
 */
async function loadLocationForUser(app: Application, user: Record<string, unknown>): Promise<Record<string, unknown>> {
  let location: Record<string, unknown> | undefined

  const locationId = user.activeLocationId as string | undefined
  if (locationId) {
    location = await app.service('locations').get(locationId, { provider: undefined }) as Record<string, unknown>
  } else {
    const result = await app.service('locations').find({ query: { $limit: 1 }, provider: undefined, paginate: false }) as unknown[]
    location = Array.isArray(result) ? result[0] as Record<string, unknown> : undefined
  }

  if (!location) {
    throw new Error('Kein Standort konfiguriert')
  }

  return location
}

async function loadPrintersFromLocation(app: Application, user: Record<string, unknown>): Promise<PrinterConfig[]> {
  const location = await loadLocationForUser(app, user)
  const settings = location.settings as Record<string, unknown> | undefined
  const printSettings = settings?.printSettings as Record<string, unknown> | undefined
  return (printSettings?.printers as PrinterConfig[]) ?? []
}
