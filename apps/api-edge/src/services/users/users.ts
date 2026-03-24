// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  userDataResolver,
  userDataValidator,
  userExternalResolver,
  userPatchResolver,
  userPatchValidator,
  userQueryResolver,
  userQueryValidator,
  userResolver
} from './users.schema'

import type { Application } from '../../declarations'
import type { User } from './users.class'
import { authorize } from '../../hooks/authorize.hook'
import { multiTenancy } from '../../hooks/multi-tenancy.hook'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared/common'
import { Conflict } from '@feathersjs/errors'

export const usersPath = 'users'
export const usersMethods = ['find', 'get', 'create', 'patch', 'remove', 'checkin', 'checkout', 'startBreak', 'endBreak'] as const

export type { UserService } from './users.class'
export * from './users.schema'

// A configure function that registers the service and its hooks via `app.configure`
export const users = (app: Application) => {
  const paginate = app.get('paginate')

  // 1. Determine DB type
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any

  // 2. Load model (SQLite or MongoDB)
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  } else {
    // If we are in cloud mode, we load the Mongoose model.
    // Note: The file 'users.model' may not exist in the Edge project,
    // which is okay because Edge almost always runs in SQLite mode.
    // For clean code, we could use a dynamic import here or
    // move the model to the lib. For now, the placeholder is sufficient.
    // Model = require('./users.model').default(app)
  }

  // 3. Create service instance via the factory
  // The factory directly returns a KnexService or MongoDBService instance.
  const service = createServiceAdapter<User>(app, {
    name: 'users',
    Model,
    paginate,
    id: '_id'
  }) as any

  // Custom method: checkin — creates a working-time entry and stamps the user
  service.checkin = async (data: string | { userId: string }) => {
    const userId = typeof data === 'string' ? data : data.userId
    const user = await app.service('users').get(userId, { provider: undefined })
    if (user.stampingId) throw new Conflict('Benutzer ist bereits eingestempelt')

    // Determine businessDay from the user's active location
    let businessDay: string | undefined
    try {
      if (user.activeLocationId) {
        const location = await app.service('locations').get(user.activeLocationId, { provider: undefined })
        businessDay = location.currentBusinessDay?.date
      }
    } catch {
      // Fallback: no businessDay
    }
    if (!businessDay) {
      businessDay = new Date().toISOString().slice(0, 10)
    }

    const workingTime = await app.service('working-times').create(
      {
        userId,
        businessDay,
        checkinDate: new Date().toISOString(),
        tenantId: user.tenantId,
        locationId: user.activeLocationId || null,
      } as any,
      { provider: undefined }
    )
    return app.service('users').patch(userId, { stampingId: workingTime._id }, { provider: undefined })
  }

  // Custom method: checkout — closes the working-time entry and clears the stamp
  service.checkout = async (data: string | { userId: string }) => {
    const userId = typeof data === 'string' ? data : data.userId
    const user = await app.service('users').get(userId, { provider: undefined })
    if (!user.stampingId) throw new Conflict('Benutzer ist nicht eingestempelt')
    const now = new Date().toISOString()
    await app.service('working-times').patch(
      user.stampingId,
      { checkoutDate: now, originCheckoutDate: now },
      { provider: undefined }
    )
    return app.service('users').patch(userId, { stampingId: null, startBreakAt: null }, { provider: undefined })
  }

  // Custom method: startBreak — records break start time on the user
  service.startBreak = async (data: string | { userId: string }) => {
    const userId = typeof data === 'string' ? data : data.userId
    const user = await app.service('users').get(userId, { provider: undefined })
    if (!user.stampingId) throw new Conflict('Benutzer ist nicht eingestempelt')
    if (user.startBreakAt) throw new Conflict('Benutzer ist bereits in der Pause')
    return app.service('users').patch(userId, { startBreakAt: new Date().toISOString() }, { provider: undefined })
  }

  // Custom method: endBreak — appends break to working-time and clears break start
  service.endBreak = async (data: string | { userId: string }) => {
    const userId = typeof data === 'string' ? data : data.userId
    const user = await app.service('users').get(userId, { provider: undefined })
    if (!user.stampingId) throw new Conflict('Benutzer ist nicht eingestempelt')
    if (!user.startBreakAt) throw new Conflict('Benutzer ist nicht in der Pause')
    const workingTime = await app.service('working-times').get(user.stampingId, { provider: undefined })
    const updatedBreaks = [
      ...(Array.isArray(workingTime.breaks) ? workingTime.breaks : []),
      { from: user.startBreakAt, to: new Date().toISOString() }
    ]
    await app.service('working-times').patch(user.stampingId, { breaks: updatedBreaks }, { provider: undefined })
    return app.service('users').patch(userId, { startBreakAt: null }, { provider: undefined })
  }

  // 4. Register the service - as any, since the Factory returns KnexService OR MongoDBService
  app.use(usersPath, service as any, {
    methods: usersMethods,
    events: []
  })

  // 5. Register hooks
  app.service(usersPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false }),

        schemaHooks.resolveExternal(userExternalResolver),
        schemaHooks.resolveResult(userResolver)
      ]
    },
    before: {
      all: [schemaHooks.validateQuery(userQueryValidator), schemaHooks.resolveQuery(userQueryResolver)],
      find: [],
      get: [],
      create: [schemaHooks.validateData(userDataValidator), schemaHooks.resolveData(userDataResolver)],
      patch: [schemaHooks.validateData(userPatchValidator), schemaHooks.resolveData(userPatchResolver)],
      remove: []
    },
    after: {
      all: []
    },
    error: {
      all: []
    }
  })
}

// NOTE: The 'declare module' block has been REMOVED HERE.
// We'll clean this up in declarations.ts.
