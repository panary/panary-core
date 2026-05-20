import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  workingTimeDataResolver,
  workingTimeDataValidator,
  workingTimeExternalResolver,
  workingTimePatchResolver,
  workingTimePatchValidator,
  workingTimeQueryResolver,
  workingTimeQueryValidator,
  workingTimeResolver
} from './working-times.schema'

import type { Application } from '../../declarations'
import { authorize } from '@panary/shared-backend'
import { multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  workingTimeDataSchema,
  workingTimePatchSchema,
  workingTimeQuerySchema,
  workingTimeSchema
} from '@panary/working-times/domain'
import type { WorkingTime, WorkingTimeService } from './working-times.class'
import { getJsonFieldHooks } from '@panary/shared-backend'

const WORKING_TIME_JSON_FIELDS = ['breaks']

export const workingTimesPath = 'working-times'
export const workingTimesMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './working-times.schema'

export const workingTimes = (app: Application) => {
  const paginate = app.get('paginate')

  // 1. Determine DB type
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any

  // 2. Load model (SQLite or MongoDB)
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  }

  // 3. Create service instance (factory decides between SQLite and MongoDB)
  const service = createServiceAdapter<WorkingTime>(app, {
    name: 'working-times',
    Model,
    paginate,
    id: '_id',
    multi: []
  }) as unknown as WorkingTimeService

  // 4. Register the service
  app.use(workingTimesPath, service as any, {
    methods: workingTimesMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Arbeitszeiten',
      schemas: {
        workingTime: workingTimeSchema,
        workingTimeData: workingTimeDataSchema,
        workingTimePatch: workingTimePatchSchema,
        workingTimeQuery: workingTimeQuerySchema
      }
    }
  })

  const jsonHooks = getJsonFieldHooks(app, WORKING_TIME_JSON_FIELDS)

  // 5. Register hooks
  app.service(workingTimesPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false }),

        schemaHooks.resolveExternal(workingTimeExternalResolver),
        schemaHooks.resolveResult(workingTimeResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(workingTimeQueryValidator),
        schemaHooks.resolveQuery(workingTimeQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(workingTimeDataValidator),
        schemaHooks.resolveData(workingTimeDataResolver),
        ...jsonHooks.before
      ],
      patch: [
        schemaHooks.validateData(workingTimePatchValidator),
        schemaHooks.resolveData(workingTimePatchResolver),
        ...jsonHooks.before
      ],
      remove: []
    },
    after: {
      all: [...jsonHooks.after]
    },
    error: {
      all: []
    }
  })
}
