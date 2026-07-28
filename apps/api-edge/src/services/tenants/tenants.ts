import { authenticate } from '@feathersjs/authentication'
import type { NextFunction } from '@feathersjs/feathers'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { authorize, getJsonFieldHooks } from '@panary/shared-backend'

const TENANT_JSON_FIELDS = ['branding', 'localization', 'legalEntity', 'tse']

import {
  tenantDataResolver,
  tenantDataValidator,
  tenantExternalResolver,
  tenantPatchResolver,
  tenantPatchValidator,
  tenantQueryResolver,
  tenantQueryValidator,
  tenantResolver,
} from './tenants.schema'

import type { Application, HookContext } from '../../declarations'
import { cloudManaged } from '../../hooks/cloud-managed.hook'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  edgeTenantDataSchema,
  edgeTenantPatchSchema,
  edgeTenantQuerySchema,
  edgeTenantSchema,
} from '@panary/tenants/domain'
import type { EdgeTenant, TenantService } from './tenants.class'

export const tenantsPath = 'tenants'
export const tenantsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './tenants.schema'

// Ersatz fuer multiTenancy(): Die tenants-Replica traegt KEINE tenantId-Spalte —
// ihr `_id` IST der Tenant-Identifier (analog zur eigenen Allowlist des
// Multi-Tenancy-Hooks in der Cloud). Externe Zugriffe werden hart auf den
// eigenen Tenant gescoped; platform:*-Rollen behalten den gewohnten Bypass,
// interne Aufrufe (Sync-Pull mit provider: undefined) laufen ungefiltert.
const scopeToOwnTenant = async (context: HookContext, next: NextFunction) => {
  const { user } = context.params
  if (!user || (user.role && user.role.startsWith('platform:'))) return next()
  if (['find', 'get', 'remove', 'update', 'patch'].includes(context.method)) {
    const query = context.params.query || {}
    query._id = user.tenantId
    context.params.query = query
  }
  return next()
}

export const tenants = (app: Application) => {
  const paginate = app.get('paginate')

  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  }

  const service = createServiceAdapter<EdgeTenant>(app, {
    name: 'tenants',
    Model,
    paginate,
    id: '_id',
    multi: [],
  }) as unknown as TenantService

  app.use(tenantsPath, service as any, {
    methods: tenantsMethods,
    events: [],
    docs: {
      description:
        'Tenant-Stammdaten-Replica (Cloud-managed, am Edge read-only; Pull-Apply der Allowlist-Projection projectTenantForEdge)',
      schemas: {
        tenant: edgeTenantSchema,
        tenantData: edgeTenantDataSchema,
        tenantPatch: edgeTenantPatchSchema,
        tenantQuery: edgeTenantQuerySchema,
      },
    },
  })

  const jsonHooks = getJsonFieldHooks(app, TENANT_JSON_FIELDS)

  app.service(tenantsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        // Source of Truth ist die Cloud — externe Writes am Edge nach Pairing blocken.
        cloudManaged(),
        scopeToOwnTenant,
        schemaHooks.resolveExternal(tenantExternalResolver),
        schemaHooks.resolveResult(tenantResolver),
      ],
    },
    before: {
      all: [schemaHooks.validateQuery(tenantQueryValidator), schemaHooks.resolveQuery(tenantQueryResolver)],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(tenantDataValidator),
        schemaHooks.resolveData(tenantDataResolver),
        ...jsonHooks.before,
      ],
      patch: [
        schemaHooks.validateData(tenantPatchValidator),
        schemaHooks.resolveData(tenantPatchResolver),
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
