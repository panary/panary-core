import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  deviceDataResolver,
  deviceDataValidator,
  deviceExternalResolver,
  devicePatchResolver,
  devicePatchValidator,
  deviceQueryResolver,
  deviceQueryValidator,
  deviceResolver
} from './devices.schema'

import type { Application } from '../../declarations'
import { authorize } from '@panary-core/shared-backend'
import { multiTenancy } from '@panary-core/shared-backend'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared-common'
import {
  deviceDataSchema,
  devicePatchSchema,
  deviceQuerySchema,
  deviceSchema
} from '@panary-core/devices/domain'
import type { Device, DeviceService } from './devices.class'
import { ensureIndexes, logger } from '@panary-core/shared-backend'

export const devicesPath = 'devices'
export const devicesMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './devices.schema'

export const devices = (app: Application) => {
  const paginate = app.get('paginate')

  // 1. Determine DB type
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any

  // 2. Load model (SQLite or MongoDB)
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  } else {
    // MongoDB Model (for Enterprise/Cloud)
    // If we are in cloud mode, we load the Mongoose model.
    // Note: The file 'users.model' may not exist in the Edge project,
    // which is okay because Edge almost always runs in SQLite mode.
    // For clean code, we could use a dynamic import here or
    // move the model to the lib. For now, the placeholder is sufficient.
    // Model = require('./users.model').default(app)
  }

  // 3. Create service instance (factory decides between SQLite and MongoDB)
  const service = createServiceAdapter<Device>(app, {
    name: 'devices',
    Model,
    paginate,
    id: '_id',
    multi: []
  }) as unknown as DeviceService

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'devices',
      [
        { name: 'idx_devices_tenant', columns: ['tenantId'] },
        { name: 'idx_devices_tenant_location', columns: ['tenantId', 'locationId'] },
        {
          name: 'idx_devices_tenant_deviceId_unique',
          columns: ['tenantId', 'deviceId'],
          unique: true,
          dbTypes: [DatabaseType.MONGODB],
        },
        { name: 'idx_devices_status', columns: ['status'], dbTypes: [DatabaseType.MONGODB] },
      ],
      service,
    )

  // 4. Register the service - as any, since the Factory returns KnexService OR MongoDBService
  app.use(devicesPath, service as any, {
    methods: devicesMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Devices',
      schemas: {
        device: deviceSchema,
        deviceData: deviceDataSchema,
        devicePatch: devicePatchSchema,
        deviceQuery: deviceQuerySchema
      }
    }
  })

  // 5. Register hooks
  app.service(devicesPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(deviceExternalResolver),
        schemaHooks.resolveResult(deviceResolver)
      ]
    },
    before: {
      all: [schemaHooks.validateQuery(deviceQueryValidator), schemaHooks.resolveQuery(deviceQueryResolver)],
      find: [],
      get: [],
      create: [schemaHooks.validateData(deviceDataValidator), schemaHooks.resolveData(deviceDataResolver)],
      patch: [schemaHooks.validateData(devicePatchValidator), schemaHooks.resolveData(devicePatchResolver)],
      remove: []
    },
    after: {
      all: [],
      // Bei Device-Registrierung automatisch einen API-Key erstellen und im Response zurückgeben
      create: [
        async context => {
          const device = context.result as any
          if (!device?._id) return context

          try {
            // Raw-Key hier generieren und als _rawApiKey mitgeben, damit der
            // apikeyDataResolver diesen verwendet statt einen neuen zu erzeugen.
            // Bei internen Aufrufen (provider: undefined) laeuft der externalResolver
            // NICHT, daher muss der Raw-Key explizit weitergegeben werden.
            const { randomUUID } = await import('node:crypto')
            const rawApiKey = randomUUID()

            const apiKeyRecord = await context.app.service('apikeys').create(
              {
                name: `${device.name} API Key`,
                deviceId: device.deviceId,
                tenantId: device.tenantId,
                locationId: device.locationId,
              },
              { provider: undefined, _rawApiKey: rawApiKey } as any,
            )

            // deviceId → apiKeyId verknüpfen
            await context.app.service('devices').patch(device._id, { apiKeyId: apiKeyRecord._id }, { provider: undefined })

            // Klartext-Key an den Client zurueckgeben (Show-Once)
            device.apiKey = rawApiKey
          } catch (err) {
            logger.error({ message: 'Failed to create API key for device', event: 'devices.apikey_error', error: String(err) })
          }

          return context
        },
      ]
    },
    error: {
      all: []
    }
  })
}

// NOTE: The 'declare module' block has been REMOVED HERE.
// We'll clean this up in declarations.ts.
