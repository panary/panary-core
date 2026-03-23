// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html
import swagger from 'feathers-swagger'
import { feathers } from '@feathersjs/feathers'
import configuration from '@feathersjs/configuration'
import { bodyParser, cors, errorHandler, koa, parseAuthentication, rest } from '@feathersjs/koa'
import socketio from '@feathersjs/socketio'

import { configurationValidator } from './configuration'
import type { Application } from './declarations'
import { logError } from './hooks/log-error'
import { sqlite } from './sqlite'
import { services } from './services/index'
import { channels } from './channels'
import { configureLoggerLevel } from './logger'
import { ensureTenantIsolation } from './hooks/ensure-tenant-isolation.hook'
import { allowApiKey } from './hooks/allow-apikey.hook'
import { authentication } from './authentication'
import { renderStatusPage } from './status-page'

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

app.use(errorHandler())
app.use(parseAuthentication())
app.use(bodyParser())

// Health check (public)
app.use(async (ctx, next) => {
  if (ctx.path === '/health' && (ctx.method === 'GET' || ctx.method === 'HEAD')) {
    ctx.body = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version
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
app.configure(channels)

// App-level hooks
app.hooks({
  around: {
    all: [logError, allowApiKey()]
  },
  before: {},
  after: {
    all: [ensureTenantIsolation()]
  },
  error: {}
})
app.hooks({ teardown: [] })

export { app }
