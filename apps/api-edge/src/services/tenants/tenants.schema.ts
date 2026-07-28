import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary/shared-backend'
import { uuidv7 } from 'uuidv7'

import {
  EdgeTenant,
  edgeTenantDataSchema,
  edgeTenantPatchSchema,
  EdgeTenantQuery,
  edgeTenantQuerySchema,
} from '@panary/tenants/domain'
import { TenantService } from './tenants.class'

//#region 1. Main Resolver (Output)
export const tenantResolver = resolve<EdgeTenant, HookContext<TenantService>>({})
// TSE-Referenzen (BWS-Secret-IDs) sind ausschliesslich fuer die Edge-interne
// TSE-Factory bestimmt — externe Clients (POS/Admin) brauchen Branding/
// Localization/LegalEntity, aber keine Provider-Refs.
export const tenantExternalResolver = resolve<EdgeTenant, HookContext<TenantService>>({
  tse: async () => undefined,
})
//#endregion

//#region 2. Create Resolver (POST)
export const tenantDataValidator = getValidator(edgeTenantDataSchema, dataValidator)
export const tenantDataResolver = resolve<EdgeTenant, HookContext<TenantService>>({
  _id: async value => value || uuidv7(),
  // Replica-Semantik: die einzige Create-Quelle ist der Cloud-Pull-Apply —
  // mitgelieferte Cloud-Werte wertschonend uebernehmen statt ueberstempeln
  // (Muster locations-Fix v26.7.35).
  createdAt: async value => value ?? new Date().toISOString(),
  updatedAt: async value => value ?? new Date().toISOString(),
})
//#endregion

//#region 3. Patch Resolver (PATCH)
export const tenantPatchValidator = getValidator(edgeTenantPatchSchema, dataValidator)
export const tenantPatchResolver = resolve<EdgeTenant, HookContext<TenantService>>({
  _id: async () => undefined,
  createdAt: async () => undefined,
  // Sync-Patches liefern das Cloud-updatedAt mit — wertschonend uebernehmen.
  updatedAt: async value => value ?? new Date().toISOString(),
})
//#endregion

//#region 4. Query Resolver (GET)
export const tenantQueryValidator = getValidator(edgeTenantQuerySchema, queryValidator)
export const tenantQueryResolver = resolve<EdgeTenantQuery, HookContext<TenantService>>({})
//#endregion
