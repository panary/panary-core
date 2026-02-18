import './bootstrap'
import { logger } from './logger'
import fs from 'fs/promises'
import path from 'path'
import { startSetupApp } from './setup-app'
import { constants } from 'fs'

const CONFIG_PATH =
  process.env['PANARY_CONFIG_PATH'] || path.join(process.cwd(), 'data', 'panary.config.json')

async function main() {
  try {
    // Check if config file exists
    await fs.access(CONFIG_PATH, constants.F_OK)

    logger.info(`Configuration found at ${CONFIG_PATH}. Starting in PRODUCTION MODE.`)

    // Load configuration
    try {
      const configRaw = await fs.readFile(CONFIG_PATH, 'utf-8')
      const config = JSON.parse(configRaw)

      // Set environment variables from config
      for (const [key, value] of Object.entries(config)) {
        // We only set primitive values as env vars. Objects/Arrays are likely specific config sections handled by Feathers config
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          process.env[key] = String(value)
        }
      }

      // Inject the config object into NODE_CONFIG for Feathers/Node-Config to pick up deeply nested values override
      // process.env['NODE_CONFIG'] = JSON.stringify(config)
      // User requested "set environment variables", assuming simpler flat env vars for now or standard feathers behavior.
    } catch (e) {
      logger.error('Error reading configuration file', e)
      throw e
    }

    // Dynamic import of app to prevent early initialization
    const { app } = await import('./app')

    // Add Status Route for configured state
    app.use(async (ctx, next) => {
      if (ctx.path === '/api/system-info' && ctx.method === 'GET') {
        // Re-implement or import getLocalIpAddress? For now just basic status.
        // User asked for "Zustand (Standalone vs. Cloud, Tenant-ID)"
        ctx.body = {
          status: 'configured',
          mode: process.env['MODE'] || 'unknown',
          tenantId: process.env['TENANT_ID'] || 'unknown'
          // Add IP if needed, but 'system-info' in setup-app returns IP.
          // User asked for "/status" to provide info.
        }
        return
      }
      // Also alias /status as requested
      if (ctx.path === '/status' && ctx.method === 'GET') {
        ctx.body = {
          status: 'configured',
          mode: process.env['MODE'] || 'unknown',
          tenantId: process.env['TENANT_ID'] || 'unknown'
        }
        return
      }
      await next()
    })

    const port = app.get('port') || 3030
    const host = app.get('host') || 'localhost'

    process.on('unhandledRejection', (reason, p) =>
      logger.error('Unhandled Rejection at: Promise ', p, reason)
    )

    app.listen(port, () => {
      logger.info(`Feathers app listening on http://${host}:${port}`)
    })
  } catch (error) {
    // Config file not found or error loading it -> Setup Mode
    logger.warn(`Configuration check failed or file missing at ${CONFIG_PATH}. Starting in SETUP MODE.`)
    // Port 3030 for setup as well? Yes.
    await startSetupApp(3030)
  }
}

main().catch(err => {
  logger.error('Fatal error during startup', err)
  process.exit(1)
})
