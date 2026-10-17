import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary/shared-backend'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  CorporateCustomer,
  corporateCustomerDataSchema,
  corporateCustomerPatchSchema,
  CorporateCustomerQuery,
  corporateCustomerQuerySchema,
} from '@panary/corporate-customers/domain'
import { CorporateCustomerService } from './corporate-customers.class'

//#region 1. Main Resolver (Output)
export const corporateCustomerResolver = resolve<CorporateCustomer, HookContext<CorporateCustomerService>>({})
export const corporateCustomerExternalResolver = resolve<CorporateCustomer, HookContext<CorporateCustomerService>>({})
//#endregion

//#region 2. Create Resolver (POST)
export const corporateCustomerDataValidator = getValidator(corporateCustomerDataSchema, dataValidator)
export const corporateCustomerDataResolver = resolve<CorporateCustomer, HookContext<CorporateCustomerService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },

  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  // Gleiches Vokabular wie die Cloud (`active | disabled | blocked | archived`, Default `active`
  // seit panary/panary-cloud#932). `DRAFT` kannte dort niemand — ein an der Edge angelegter
  // Firmenkunde stand in der Cloud als „Ohne Status“ und fiel durch jeden Filter (#511).
  // Ein mitgeschickter Status (Sync aus der Cloud, POS) bleibt unverändert.
  status: async value => value || 'active',
  ordersCount: async () => 0,
  // `invoices` ist eine SQLite-TEXT-Spalte (JSON-Array, defaultTo '[]'). Der
  // geteilte `dataValidator` hat KEIN `useDefaults`, daher greift der
  // Schema-Default [] nicht — bei Sync-Records ohne invoices kommt `undefined`
  // an, und knex/better-sqlite3 kann undefined nicht binden (Insert bricht).
  // Serialisiert wird danach von den getJsonFieldHooks (CORPORATE_CUSTOMER_JSON_FIELDS).
  invoices: async value => value ?? [],
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)
export const corporateCustomerPatchValidator = getValidator(corporateCustomerPatchSchema, dataValidator)
export const corporateCustomerPatchResolver = resolve<CorporateCustomer, HookContext<CorporateCustomerService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
  // `invoices`/`address`/`discountDetails` serialisieren die getJsonFieldHooks
  // (core#735) — fehlt ein Feld im Patch, bleibt der gespeicherte Wert stehen.
})
//#endregion

// --- 4. Query Resolver (GET) ---
export const corporateCustomerQueryValidator = getValidator(corporateCustomerQuerySchema, queryValidator)
export const corporateCustomerQueryResolver = resolve<CorporateCustomerQuery, HookContext<CorporateCustomerService>>({
  // TODO: Add query resolver logic here
  // Example: Restriction to own data for normal users
  // _id: async (value, query, context) => {
  //   if (context.params.user?.role !== 'admin') {
  //     return context.params.user?.id
  //   }
  //   return value
  // }
})
//#endregion
