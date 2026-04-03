// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html
import swagger from 'feathers-swagger'
import { feathers } from '@feathersjs/feathers'
import configuration from '@feathersjs/configuration'
import { bodyParser, cors, errorHandler, koa, parseAuthentication, rest } from '@feathersjs/koa'
import socketio from '@feathersjs/socketio'

import path from 'path'
import fs from 'fs'
import { configurationValidator } from './configuration'
import type { Application, HookContext, NextFunction } from './declarations'
import { canonicalLog } from './hooks/canonical-log.hook'
import { logError } from './hooks/log-error'
import { sqlite } from './sqlite'
import { services } from './services/index'
import { channels } from './channels'
import { configureLoggerLevel } from './logger'
import { ensureTenantIsolation } from './hooks/ensure-tenant-isolation.hook'
import { allowApiKey } from './hooks/allow-apikey.hook'
import { secureByDefault } from './hooks/secure-by-default.hook'
import { authentication } from './authentication'
import os from 'os'
import { getLocalIpAddress, renderStatusPage } from './status-page'
import { configurePrintServer } from './print-server/index'

const app: Application = koa(feathers())

app.configure(configuration(configurationValidator))
configureLoggerLevel(app)

app.configure(
  swagger({
    specs: {
      info: {
        title: 'Panary Edge API',
        description:
          'Panary API is a backend service built with FeathersJS, designed to streamline and manage food ordering processes. It provides RESTful and real-time endpoints for handling orders, managing menus, tracking deliveries, and processing payments, aimed at enhancing the efficiency and user experience of food service applications.',
        version: '1.0.0'
      },
      schemes: ['http', 'https'],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      },
      security: [{ BearerAuth: [] }]
    },
    ui: swagger.swaggerUI({ docsPath: '/docs' }),
    idType: 'string'
  })
)

// Koa middleware
app.use(cors())

// Status page
app.use(async (ctx, next) => {
  if (ctx.path === '/' && ctx.method === 'GET') {
    const host = app.get('host') || 'localhost'
    const port = app.get('port') || 3030
    ctx.type = 'html'
    ctx.body = renderStatusPage({ host, port })
    return
  }
  await next()
})

// Admin SPA — statische Dateien unter /admin ausliefern
const adminDistPath = path.resolve(process.cwd(), 'dist/apps/admin-client/browser')

// Favicon & Root-Assets: Browser fragt immer /favicon.svg vom Root an, unabhängig vom SPA-Pfad
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && (ctx.path === '/favicon.svg' || ctx.path === '/favicon.ico')) {
    const filePath = path.join(adminDistPath, ctx.path.slice(1))
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      ctx.type = path.extname(filePath)
      ctx.body = fs.createReadStream(filePath)
      return
    }
  }
  await next()
})

app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path.startsWith('/admin')) {
    const subPath = ctx.path.replace(/^\/admin\/?/, '') || 'index.html'
    const filePath = path.join(adminDistPath, subPath)

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      ctx.type = path.extname(filePath)
      ctx.body = fs.createReadStream(filePath)
      return
    }

    // SPA Fallback — alle nicht-gefundenen Routen auf index.html
    const indexPath = path.join(adminDistPath, 'index.html')
    if (fs.existsSync(indexPath)) {
      ctx.type = 'html'
      ctx.body = fs.createReadStream(indexPath)
      return
    }
  }
  await next()
})

app.use(errorHandler())
app.use(parseAuthentication())
app.use(bodyParser())

// Health check (public) — liefert Systeminfos für Dashboard, Monitoring und Servicetechniker
app.use(async (ctx, next) => {
  if (ctx.path === '/health' && (ctx.method === 'GET' || ctx.method === 'HEAD')) {
    const mem = process.memoryUsage()
    ctx.body = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '0.0.0',
      systemMode: app.get('system')?.mode || 'standalone',
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      hostname: os.hostname(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      localIp: getLocalIpAddress(),
      port: app.get('port'),
      database: {
        type: app.get('system')?.dbType || 'sqlite',
      },
    }
    ctx.status = 200
    return
  }
  await next()
})

// Transports
app.configure(rest())
app.configure(
  socketio(
    {
      cors: { origin: app.get('origins') },
      path: '/ws',
      serveClient: false,
      pingInterval: 10000,
      pingTimeout: 5000,
      cookie: false
    },
    io => {
      io.use((socket: any, next: any) => {
        ;(socket as any).feathers._socket = socket
        if (socket.handshake) {
          ;(socket as any).feathers.handshake = socket.handshake
        }
        next()
      })
    }
  )
)

// Services & data
app.configure(authentication)
app.configure(sqlite)
app.configure(services)
app.configure(configurePrintServer)
app.configure(channels)

// App-level hooks (global für alle Services)
// Reihenfolge der around-Hooks (Onion-Modell, äußerster zuerst):
// 1. canonicalLog     — umschließt alles, misst Dauer, loggt Wide Event
// 2. logError         — fängt interne Fehler (kein Provider)
// 3. allowApiKey      — API-Key-Auth → virtueller User (vor Security-Checks)
// 4. secureByDefault  — authenticate('jwt') + authorize() (erwartet next)
// 5. tenantIsolation  — prüft nach Service-Ausführung die Tenant-Zugehörigkeit
app.hooks({
  around: [
    canonicalLog,
    logError,
    allowApiKey(),
    secureByDefault({ publicServices: ['authentication'] }),
    async (context: HookContext, next: NextFunction) => {
      await next()
      await ensureTenantIsolation()(context)
    },
  ],
})

export { app }
