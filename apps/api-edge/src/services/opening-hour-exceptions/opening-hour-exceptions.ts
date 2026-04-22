import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  openingHourExceptionDataResolver,
  openingHourExceptionDataValidator,
  openingHourExceptionExternalResolver,
  openingHourExceptionPatchResolver,
  openingHourExceptionPatchValidator,
  openingHourExceptionQueryResolver,
  openingHourExceptionQueryValidator,
  openingHourExceptionResolver,
} from './opening-hour-exceptions.schema'

import type { Application } from '../../declarations'
import { authorize } from '@panary-core/shared-backend'
import { multiTenancy } from '@panary-core/shared-backend'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared-common'
import {
  openingHourExceptionDataSchema,
  openingHourExceptionPatchSchema,
  openingHourExceptionQuerySchema,
  openingHourExceptionSchema,
} from '@panary-core/opening-hour-exceptions/domain'
import type { OpeningHourException, OpeningHourExceptionService } from './opening-hour-exceptions.class'
import { logger } from '@panary-core/shared-backend'

export const openingHourExceptionsPath = 'opening-hour-exceptions'
export const openingHourExceptionsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './opening-hour-exceptions.schema'

export const openingHourExceptions = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  }

  const service = createServiceAdapter<OpeningHourException>(app, {
    name: 'opening-hour-exceptions',
    Model,
    paginate,
    id: '_id',
    multi: [],
  }) as unknown as OpeningHourExceptionService

  ;(service as any).setup = async (app: Application, _path: string) => {
    const systemConfig = app.get('system') || {}
    const dbType = systemConfig.dbType || DatabaseType.SQLITE

    if (dbType === DatabaseType.SQLITE) {
      const knex = app.get('sqliteClient')
      const tableName = 'opening-hour-exceptions'

      try {
        const hasTable = await knex.schema.hasTable(tableName)
        if (hasTable) {
          await knex.raw(`CREATE INDEX IF NOT EXISTS "idx_opening-hour-exceptions_tenant" ON "${tableName}" (tenantId)`)
          await knex.raw(
            `CREATE INDEX IF NOT EXISTS "idx_opening-hour-exceptions_tenant_date" ON "${tableName}" (tenantId, date)`,
          )
          logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'sqlite', service: openingHourExceptionsPath })
        }
      } catch (error) {
        logger.error({
          message: 'Failed to ensure indexes',
          event: 'db.indexes_error',
          dbType: 'sqlite',
          service: openingHourExceptionsPath,
          error: String(error),
        })
      }
    }
  }

  app.use(openingHourExceptionsPath, service as any, {
    methods: openingHourExceptionsMethods,
    events: [],
    docs: {
      description: 'Verwaltung von Öffnungszeiten-Ausnahmen (Feiertage, Betriebsurlaub)',
      schemas: {
        openingHourException: openingHourExceptionSchema,
        openingHourExceptionData: openingHourExceptionDataSchema,
        openingHourExceptionPatch: openingHourExceptionPatchSchema,
        openingHourExceptionQuery: openingHourExceptionQuerySchema,
      },
    },
  })

  app.service(openingHourExceptionsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(openingHourExceptionExternalResolver),
        schemaHooks.resolveResult(openingHourExceptionResolver),
      ],
    },
    before: {
      all: [
        schemaHooks.validateQuery(openingHourExceptionQueryValidator),
        schemaHooks.resolveQuery(openingHourExceptionQueryResolver),
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(openingHourExceptionDataValidator),
        schemaHooks.resolveData(openingHourExceptionDataResolver),
      ],
      patch: [
        schemaHooks.validateData(openingHourExceptionPatchValidator),
        schemaHooks.resolveData(openingHourExceptionPatchResolver),
      ],
      remove: [],
    },
    after: {
      all: [],
    },
    error: {
      all: [],
    },
  })
}
