import { authenticate } from '@feathersjs/authentication'
import { BadRequest } from '@feathersjs/errors'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { validateData } from '../../hooks/validate-data.hook'

import { authorize, getJsonFieldHooks, multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import { type SyncConflict, type SyncConflictResolution } from '@panary/sync/domain'

import type { Application } from '../../declarations'
import type { HookContext } from '../../declarations'
import { logger } from '@panary/shared-backend'
import { applyConflictResolution } from './apply-resolution'
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

/**
 * Wendet die Aufloesung an, BEVOR der Konflikt als `resolved` geschrieben wird.
 *
 * Die Reihenfolge ist der eigentliche Fix aus panary/panary-core#293. Vorher lief
 * das Anwenden als After-Hook mit verschlucktem Fehler: Der Konflikt stand
 * danach auf `status=resolved, resolution=use-cloud`, der Zieldatensatz war
 * unveraendert, und die einzige Spur war ein `logger.warn`. Als Before-Hook gibt
 * es diesen Zustand nicht mehr — schlaegt das Anwenden fehl, scheitert der
 * ganze Patch, der Konflikt bleibt `open` und die UI zeigt den Grund an
 * (`sync-conflicts.ts` im admin-client sammelt Patch-Fehler in `errors()`).
 *
 * Die umgekehrte Fehlerrichtung ist die harmlose: Gelingt das Anwenden und
 * scheitert danach das Schreiben des Konflikt-Status, bleibt der Konflikt offen
 * und ein zweiter Klick wiederholt einen idempotenten Patch.
 *
 * `sync.conflict.apply_failed` bleibt als Log-Event erhalten — jetzt aber
 * IMMER zusammen mit einem Fehler an den Aufrufer, nie mehr allein.
 */
const applyResolutionBeforePatch = async (context: HookContext) => {
  const resolution = (context.data as { resolution?: SyncConflictResolution } | undefined)?.resolution
  if (!resolution) return context

  if (context.id === null || context.id === undefined) {
    throw new BadRequest('Konflikte koennen nur einzeln aufgeloest werden.')
  }

  const conflict = (await context.app
    .service(syncConflictsPath)
    .get(String(context.id), { provider: undefined } as any)) as SyncConflict

  try {
    await applyConflictResolution(context.app, { ...conflict, resolution })
  } catch (err) {
    logger.warn({
      message: 'Konflikt-Aufloesung konnte nicht angewandt werden — Konflikt bleibt offen',
      event: 'sync.conflict.apply_failed',
      conflictId: conflict._id,
      service: conflict.service,
      resolution,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    throw err
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

  // `edgePayload`/`cloudPayload` sind `text`-Spalten mit JSON-Inhalt
  // (20260502000002_sync_conflicts). Ohne diese Hooks kommt der Payload beim
  // Lesen als STRING zurueck — `cloudPayload._id` war dadurch `undefined`, der
  // USE_CLOUD-Apply lief als Multi-Patch mit einem String als Data und starb an
  // AJV („validation failed"). Gemessen am 2026-09-12 (#293).
  const jsonHooks = getJsonFieldHooks(app, ['edgePayload', 'cloudPayload'])

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
      all: [schemaHooks.validateQuery(syncConflictQueryValidator), schemaHooks.resolveQuery(syncConflictQueryResolver)],
      create: [
        validateData(syncConflictDataValidator),
        schemaHooks.resolveData(syncConflictDataResolver),
        ...jsonHooks.before,
      ],
      patch: [
        validateData(syncConflictPatchValidator),
        schemaHooks.resolveData(syncConflictPatchResolver),
        applyResolutionBeforePatch,
      ],
    },
    after: {
      all: [...jsonHooks.after],
    },
    error: { all: [] },
  })
}
