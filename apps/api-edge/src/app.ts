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
import { configureLoggerLevel, logger } from './logger'
import { ensureTenantIsolation } from './hooks/ensure-tenant-isolation.hook'
import { authentication } from './authentication'
import { renderStatusPage } from './status-page'

logger.debug('Creating application...')
const app: Application = koa(feathers())

// Load our app configuration (see config/ folder)
logger.debug('Loading configuration...')
app.configure(configuration(configurationValidator))

// Configure logger level from config
configureLoggerLevel(app)

logger.debug('Setting up swagger...')
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
            // Name der Strategie
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT' // Optional, für Doku
          }
        }
      },
      // Enable globally (optional):
      security: [{ BearerAuth: [] }]
    },
    ui: swagger.swaggerUI({ docsPath: '/docs' }),

    // IMPORTANT: To ensure that TypeBox schemas are recognized correctly!
    idType: 'string'
  })
)

// Set up Koa middleware
logger.debug('Setting up Koa middleware...')
app.use(cors())

// Status page at root URL
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

logger.debug('Setting up error handler...')
app.use(errorHandler())

logger.debug('Setting up authentication...')
app.configure(authentication)
app.use(parseAuthentication())

logger.debug('Setting up body parser...')
app.use(bodyParser())

// Health check endpoint BEFORE authentication middleware (public endpoint)
logger.debug('Setting up health check endpoint...')
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

// Configure services and transports
logger.debug('Configuring services and transports...')
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
      // Use Socket.io middleware to store socket reference and auth data BEFORE connection event
      // This middleware runs BEFORE the Feathers 'connection' event handler in channels.ts
      io.use((socket: any, next: any) => {
        // The socket.feathers object becomes the "connection" in Feathers channels
        // Store the actual socket object so we can call emit() later
        ;(socket as any).feathers._socket = socket

        // Copy handshake to feathers so it's accessible via connection.handshake
        if (socket.handshake) {
          ;(socket as any).feathers.handshake = socket.handshake
        }

        next()
      })
    }
  )
)

logger.debug('Configuring sqlite...')
app.configure(sqlite)

logger.debug('Configuring services...')
app.configure(services)

logger.debug('Configuring channels...')
app.configure(channels)

// Register hooks that run on all service methods
logger.debug('Registering hooks..')
app.hooks({
  around: {
    all: [logError]
  },
  before: {},
  after: {
    all: [ensureTenantIsolation()]
  },
  error: {}
})
// Register application setup and teardown hooks here
app.hooks({
  teardown: []
})

logger.debug('Exporting application')
export { app }
