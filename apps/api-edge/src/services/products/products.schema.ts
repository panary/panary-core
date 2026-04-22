import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary-core/shared-backend'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  Product,
  productDataSchema,
  productPatchSchema,
  ProductQuery,
  productQuerySchema,
  productSchema
} from '@panary-core/products/domain'
import { ProductService } from './products.class'

//#region 1. Main Resolver (Output)
export const productsValidator = getValidator(productSchema, dataValidator)
export const productsResolver = resolve<Product, HookContext<ProductService>>({
  // TODO: Add resolver logic for output here
  // Example: Hide fields, resolve relationships, etc.
})
export const productsExternalResolver = resolve<Product, HookContext>({
  // TODO: Add resolver logic for external output here
  // Example: Filtering sensitive data
})
//#endregion

//#region 2. Create Resolver (POST)
export const productsDataValidator = getValidator(productDataSchema, dataValidator)
export const productsDataResolver = resolve<Product, HookContext<ProductService>>({
  // ID is generated automatically
  _id: async value => {
    if (value) return value // Falls Client eine ID mitschickt (Sync)
    return uuidv7()
  },

  // Timestamps are set automatically
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  externalId: async (value, data, context) => {
    return value || uuidv7()
  },
  status: async (value, data, context) => {
    return value || 'DRAFT'
  },
  isInvalid: async () => false
})
//#endregion

//#region 3. Patch Resolver (PATCH)
export const productsPatchValidator = getValidator(productPatchSchema, dataValidator)
export const productsPatchResolver = resolve<Product, HookContext<ProductService>>({
  _id: async () => undefined,
  externalId: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString()
})
//#endregion

//#region 4. Query Resolver (GET)
export const productsQueryValidator = getValidator(productQuerySchema, queryValidator)
export const productsQueryResolver = resolve<ProductQuery, HookContext<ProductService>>({
  // TODO: Füge hier Query-Resolver-Logik hinzu
  // Beispiel: Einschränkung auf eigene Daten für normale User
  // _id: async (value, query, context) => {
  //   if (context.params.user?.role !== 'admin') {
  //     return context.params.user?.id
  //   }
  //   return value
  // }
})
//#endregion
