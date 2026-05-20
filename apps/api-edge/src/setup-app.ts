import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { koa, bodyParser, serveStatic } from '@feathersjs/koa'
import { logger } from '@panary/shared-backend'

// Path to configuration file
// Default to ./data/panary.config.json relative to CWD, or use env var
const CONFIG_PATH =
  process.env['PANARY_CONFIG_PATH'] || path.join(process.cwd(), 'data', 'panary.config.json')

/**
 * Get the local IP address of the device (non-internal IPv4)
 */
function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip internal (127.0.0.1) and non-IPv4 addresses
      if ('IPv4' !== iface.family || iface.internal) {
        continue
      }
      return iface.address
    }
  }
  return '127.0.0.1' // Fallback
}

export async function startSetupApp(port: number) {
  const app = koa()

  app.use(bodyParser())

  // API Routes
  app.use(async (ctx, next) => {
    if (ctx.path === '/api/system-info' && ctx.method === 'GET') {
      const ip = getLocalIpAddress()
      ctx.body = {
        status: 'unconfigured',
        ip: ip,
        url: `http://${ip}:${port}`
      }
      return
    }

    if (ctx.path === '/api/setup' && ctx.method === 'POST') {
      try {
        const config = ctx.request.body

        // Basic validation
        if (!config || typeof config !== 'object') {
          ctx.status = 400
          ctx.body = { error: 'Invalid configuration data' }
          return
        }

        // Ensure directory exists
        const configDir = path.dirname(CONFIG_PATH)
        await fs.mkdir(configDir, { recursive: true })

        // Write configuration
        await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')

        logger.info(`Configuration written to ${CONFIG_PATH}`)

        ctx.body = { status: 'OK' }

        // Graceful exit to restart in production mode
        setTimeout(() => {
          logger.info('Restarting server in 2 seconds...')
          process.exit(0)
        }, 2000)
      } catch (error: any) {
        logger.error('Failed to save configuration', error)
        ctx.status = 500
        ctx.body = { error: 'Failed to save configuration', details: error.message }
      }
      return
    }

    await next()
  })

  // Static Frontend (Setup Client)
  // Assuming the setup-client is built to dist/apps/setup-client relative to workspace root
  // If running from dist/apps/api-edge, we need to go up
  // ADJUST THIS PATH BASED ON ACTUAL BUILD ARTIFACTS
  // Debug middleware for static files
  app.use(async (ctx, next) => {
    logger.info(`Request: ${ctx.method} ${ctx.path}`)
    await next()
    if (ctx.status === 404) {
      // Check if it's an API call or asset
      if (ctx.path.startsWith('/api') || ctx.path.includes('.')) {
        logger.warn(`404 Not Found: ${ctx.path}`)
        return
      }

      // SPA Fallback: Serve index.html
      logger.info(`SPA Fallback for: ${ctx.path}`)
      const indexFile = path.isAbsolute(setupClientPath)
        ? path.join(setupClientPath, 'index.html')
        : path.join(__dirname, setupClientPath, 'index.html')

      try {
        ctx.type = 'html'
        ctx.body = await fs.readFile(indexFile, 'utf-8')
      } catch (err) {
        logger.error(`Failed to serve index.html fallback: ${err}`)
      }
    }
  })

  // Static Frontend (Setup Client)
  // Assuming the setup-client is built to dist/apps/setup-client relative to workspace root
  // If running from dist/apps/api-edge, we need to go up
  // ADJUST THIS PATH BASED ON ACTUAL BUILD ARTIFACTS
  const setupClientPath =
    process.env['SETUP_CLIENT_PATH'] || path.join(process.cwd(), 'dist/apps/setup-client/browser')

  if (path.isAbsolute(setupClientPath)) {
    app.use(serveStatic(setupClientPath))
  } else {
    app.use(serveStatic(path.join(__dirname, setupClientPath)))
  }

  app.listen(port, () => {
    logger.info(`Started in SETUP MODE on http://${getLocalIpAddress()}:${port}`)
    logger.info(`Serving setup client from ${setupClientPath}`)
  })
}
