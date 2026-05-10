import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import { authorize, multiTenancy } from '@panary-core/shared-backend'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared-common'
import {
  SyncConflictResolution,
  type SyncConflict,
} from '@panary-core/sync/domain'

import type { Application } from '../../declarations'
import type { HookContext } from '../../declarations'
import { logger } from '@panary-core/shared-backend'
import {
  syncConflictDataResolver,
  syncConflictDataValidator,
  syncConflictExternalResolver,
  syncConflictPatchResolver,
  syncConflictPatchValidator,
  syncConflictQueryResolver,
  syncConflictQueryValidator,
  syncConflictResolver,
} from './sync-conflicts.schema'

export const syncConflictsPath = 'sync-conflicts'
export const syncConflictsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

const applyResolutionAfterPatch = async (context: HookContext) => {
  const result = context.result as SyncConflict | undefined
  if (!result?.resolution || !result.cloudPayload) return context

  // Bei use-cloud: Cloud-Variante als lokalen Record uebernehmen.
  // Bei use-edge: nichts zu tun, lokale Edge-Variante bleibt.
  // Bei discard: Edge-Record loeschen, Konflikt resolved.
  try {
    if (result.resolution === SyncConflictResolution.USE_CLOUD) {
      const cloud = result.cloudPayload as { _id: string }
      await context.app
        .service(result.service as any)
        .patch(cloud._id, cloud as any, { provider: undefined } as any)
        .catch(async () => {
          await context.app
            .service(result.service as any)
            .create(cloud as any, { provider: undefined } as any)
        })
    } else if (result.resolution === SyncConflictResolution.DISCARD) {
      await context.app
        .service(result.service as any)
        .remove(result.edgeRecordId, { provider: undefined } as any)
        .catch(() => undefined)
    }
  } catch (err) {
    logger.warn({
      message: 'Konflikt-Aufloesung konnte nicht angewandt werden',
      event: 'sync.conflict.apply_failed',
      conflictId: result._id,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
  return context
}

export const syncConflicts = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE
  let Model: any
  if (dbType === DatabaseType.SQLITE) Model = app.get('sqliteClient')

  const service = createServiceAdapter<SyncConflict>(app, {
    name: syncConflictsPath,
    Model,
    paginate,
    id: '_id',
    multi: [],
  })

  app.use(syncConflictsPath, service as any, {
    methods: syncConflictsMethods,
    events: [],
    docs: { description: 'Konflikte aus Edge-Cloud-Bootstrap (Merge-by-external-id)' },
  })

  app.service(syncConflictsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false, allowGlobalData: true }),
        schemaHooks.resolveExternal(syncConflictExternalResolver),
        schemaHooks.resolveResult(syncConflictResolver),
      ],
    },
    before: {
      all: [
        schemaHooks.validateQuery(syncConflictQueryValidator),
        schemaHooks.resolveQuery(syncConflictQueryResolver),
      ],
      create: [
        schemaHooks.validateData(syncConflictDataValidator),
        schemaHooks.resolveData(syncConflictDataResolver),
      ],
      patch: [
        schemaHooks.validateData(syncConflictPatchValidator),
        schemaHooks.resolveData(syncConflictPatchResolver),
      ],
    },
    after: {
      patch: [applyResolutionAfterPatch],
    },
    error: { all: [] },
  })
}
