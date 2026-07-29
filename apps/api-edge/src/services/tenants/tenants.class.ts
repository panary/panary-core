import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

import type { EdgeTenant, EdgeTenantData, EdgeTenantPatch, EdgeTenantQuery } from '@panary/tenants/domain'

export type { EdgeTenant, EdgeTenantData, EdgeTenantPatch, EdgeTenantQuery }

export type TenantParams = KnexAdapterParams<EdgeTenantQuery> & MongoDBAdapterParams & Params

export interface TenantService extends ServiceInterface<EdgeTenant, EdgeTenantData, TenantParams, EdgeTenantPatch> {}
