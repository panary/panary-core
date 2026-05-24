import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { BadRequest } from '@feathersjs/errors'
import { getJsonFieldHooks } from '@panary/shared-backend'

const DISCOUNT_JSON_FIELDS = ['categoryIds', 'productExternalIds', 'customerIds', 'channels', 'recurringWeekdays']

import {
  discountDataResolver,
  discountDataValidator,
  discountExternalResolver,
  discountPatchResolver,
  discountPatchValidator,
  discountQueryResolver,
  discountQueryValidator,
  discountResolver,
} from './discounts.schema'

import type { Application } from '../../declarations'
import type { HookContext } from '../../declarations'
import { authorize } from '@panary/shared-backend'
import { multiTenancy } from '@panary/shared-backend'
import { cloudManaged } from '../../hooks/cloud-managed.hook'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  Discount,
  discountDataSchema,
  discountPatchSchema,
  discountQuerySchema,
  discountSchema,
  validateDiscountConsistency,
} from '@panary/discounts/domain'
import type { DiscountService } from './discounts.class'
import { ensureIndexes } from '@panary/shared-backend'

export const discountsPath = 'discounts'
export const discountsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './discounts.schema'

// Fachliche Konsistenzprüfung der Rabatt-Definition (statt Discriminated Union).
// Nur bei create (vollständiger Datensatz) — PATCH-Teilfelder würden falsche
// Fehler werfen; Definitionen werden ohnehin in der Cloud gepflegt.
const validateConsistency = async (context: HookContext) => {
  const errors = validateDiscountConsistency(context.data as Discount)
  if (errors.length > 0) {
    throw new BadRequest('Rabatt-Definition inkonsistent: ' + errors.join('; '))
  }
  return context
}

export const discounts = (app: Application) => {
  const paginate = app.get('paginate')

  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  }

  const service = createServiceAdapter<Discount>(app, {
    name: 'discounts',
    Model,
    paginate,
    id: '_id',
    multi: [],
  }) as unknown as DiscountService

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'discounts',
      [
        { name: 'idx_discounts_tenant', columns: ['tenantId'] },
        { name: 'idx_discounts_tenant_location', columns: ['tenantId', 'locationId'] },
        { name: 'idx_discounts_status', columns: ['status'] },
        { name: 'idx_discounts_method', columns: ['method'] },
      ],
      service,
    )

  app.use(discountsPath, service as any, {
    methods: discountsMethods,
    events: [],
    docs: {
      description: 'Verwaltung der Rabatte (Cloud-managed, am Edge read-only gesynct)',
      schemas: {
        discount: discountSchema,
        discountData: discountDataSchema,
        discountPatch: discountPatchSchema,
        discountQuery: discountQuerySchema,
      },
    },
  })

  const jsonHooks = getJsonFieldHooks(app, DISCOUNT_JSON_FIELDS)

  app.service(discountsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        // Source of Truth ist die Cloud — externe Writes am Edge nach Pairing blocken.
        cloudManaged(),
        multiTenancy({ isolateLocation: true, allowGlobalData: true }),
        schemaHooks.resolveExternal(discountExternalResolver),
        schemaHooks.resolveResult(discountResolver),
      ],
    },
    before: {
      all: [schemaHooks.validateQuery(discountQueryValidator), schemaHooks.resolveQuery(discountQueryResolver)],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(discountDataValidator),
        schemaHooks.resolveData(discountDataResolver),
        validateConsistency,
        ...jsonHooks.before,
      ],
      patch: [
        schemaHooks.validateData(discountPatchValidator),
        schemaHooks.resolveData(discountPatchResolver),
        ...jsonHooks.before,
      ],
      remove: [],
    },
    after: {
      all: [...jsonHooks.after],
    },
    error: {
      all: [],
    },
  })
}
