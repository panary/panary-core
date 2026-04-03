---
title: Service-Erstellungsanleitung
date: 2025-02-13
category: guide
domains: []
status: current
---

# Service Erstellen - Schritt für Schritt

## Überblick
Diese Anleitung zeigt, wie ein neuer FeathersJS Service erstellt wird, der automatisch **SQLite (Core/Edge)** oder **MongoDB (Enterprise/Cloud)** nutzt.

---

## 1. Service mit Feathers CLI generieren

```bash
cd apps/api-edge
nx feathers g service
```

**Eingaben:**
- Service Name: z.B. `products`
- Database: `SQLite` (Standard wählen)
- Authentication: `Yes` (falls benötigt)

**Generierte Dateien:**
```
apps/api-edge/src/services/products/
├── products.ts           # Service Registration
├── products.class.ts     # Service Interface
├── products.schema.ts    # Schema & Validators
└── products.hooks.ts     # (optional)
```

---

## 2 Domain Schema erstellen

### 2.1 Schema in shared Library erstellen

```bash
nx g @nx/js:lib --name=products-domain --directory=libs/domains/products/domain --bundler=tsc --unitTestRunner=vitest --tags="type:domain,domain:products" --importPath=@panary-core/products/domain
```

**Datei:** `libs/domains/products/domain/src/lib/product.schema.ts`

```typescript
import { Type } from '@feathersjs/typebox'
import type { Static } from '@feathersjs/typebox'

//#region The main data model (schema)
export const productSchema = Type.Object({
  _id: Type.String(),
  name: Type.String(),
  price: Type.Number(),
  category: Type.String(),
  createdAt: Type.Number(),
  updatedAt: Type.Number()
})
export type Product = Static<typeof productSchema>
//#endregion

//#region Schema for creation (POST)
// We only pick the fields that the client is allowed to send.
// We can also use Type.Pick(productSchema, ['name', 'price', 'category'])
export const productDataSchema = Type.Omit(productSchema, ['_id', 'createdAt', 'updatedAt'])
export type ProductData = Static<typeof productDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const productPatchSchema = Type.Partial(productDataSchema)
export type ProductPatch = Static<typeof productPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const productQueryProperties = Type.Pick(
  userSchema,
  [
    '_id',
    'name'
  ])
export const productQuerySchema = Type.Intersect([
  Type.Partial(productQueryProperties),
  Type.Object({
    $limit: Type.Optional(Type.Number()),
    $skip: Type.Optional(Type.Number()),
    $sort: Type.Optional(Type.Object({}))
  })
])
export type ProductQuery = Static<typeof productQuerySchema>
//#endregion

```

**Datei:** `libs/domains/products/domain/src/index.ts`

```typescript
export * from './lib/product.schema'
```

---

## 3 Service Class anpassen

**Datei:** `apps/api-edge/src/services/products/products.class.ts`

```typescript
import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Import
import type { Product, ProductData, ProductPatch, ProductQuery } from '@panary-core/products/domain'

export type { Product, ProductData, ProductPatch, ProductQuery }

// Combined parameter type for SQL & NoSQL
export type ProductParams = KnexAdapterParams<ProductQuery> & MongoDBAdapterParams & Params

// Service Interface - can be KnexService or MongoDBService
export interface ProductsService extends ServiceInterface<Product, ProductData, ProductParams, ProductPatch> {}
```

---

## 4 Service Schema anpassen

**Datei:** `apps/api-edge/src/services/products/products.schema.ts`

```typescript
import { resolve } from '@feathersjs/schema'
import type { Static } from '@feathersjs/typebox'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'

// Import domain schema
import {
  productDataSchema,
  productPatchSchema,
  productQuerySchema,
  productSchema
} from '@panary-core/products/domain'
import { ProductsService } from './products.class'

//#region 1. Main Resolver (Output)
export type Product = Static<typeof productSchema>
export const productValidator = getValidator(productSchema, dataValidator)
export const productResolver = resolve<Product, HookContext>({})
export const productExternalResolver = resolve<Product, HookContext<ProductService>>({})
//#endregion

//#region 2. Create Resolver (POST)
export type ProductData = Static<typeof productDataSchema>
export const productDataValidator = getValidator(productDataSchema, dataValidator)
export const productDataResolver = resolve<Product, HookContext<ProductService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },
  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})
//#endregion

//#region 3. Patch Resolver (PATCH)
export type ProductPatch = Static<typeof productPatchSchema>
export const productPatchValidator = getValidator(productPatchSchema, dataValidator)
export const productPatchResolver = resolve<Product, HookContext<ProductService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
})
//#endregion

//#region 4. Query Resolver (GET)
export type ProductQuery = Static<typeof productQuerySchema>
export const productQueryValidator = getValidator(productQuerySchema, queryValidator)
export const productQueryResolver = resolve<ProductQuery, HookContext<ProductService>>({})
//#endregion

```

---

## 5 Service Registration anpassen

**Datei:** `apps/api-edge/src/services/products/products.ts`

```typescript
import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  productDataResolver,
  productDataValidator,
  productExternalResolver,
  productPatchResolver,
  productPatchValidator,
  productQueryResolver,
  productQueryValidator,
  productResolver
} from './products.schema'

import type { Application } from '../../declarations'
import type { Product } from './products.class'
import { authorize } from '../../hooks/authorize.hook'
import { multiTenancy } from '../../hooks/multi-tenancy.hook'
import { createServiceAdapter } from '@panary-core/shared/data-access'
import { DatabaseType } from '@panary-core/shared/common'

export const productsPath = 'products'
export const productsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './products.schema'
export type { ProductsService } from './products.class'

// A configure function that registers the service and its hooks via `app.configure`
export const products = (app: Application) => {
  const paginate = app.get('paginate')

  // Determine DB type
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any

  // Load model (SQLite or MongoDB)
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  } else {
    // MongoDB Model (for Enterprise/Cloud)
    // If we are in cloud mode, we load the Mongoose model.
    // Note: The file 'users.model' may not exist in the Edge project,
    // but that's okay because Edge almost always runs in SQLite mode.
    // For clean code, we could use a dynamic import here or
    // move the model to the library. For now, the placeholder is sufficient.
    // Model = require('./products.model').default(app)
  }

  // Create service instance (factory decides between SQLite and MongoDB)
  const service = createServiceAdapter<Product>(app, {
    name: 'products',
    Model,
    paginate,
    id: '_id',
    multi: []
  })

  // Register service
  app.use(productsPath, service as any, {
    methods: productsMethods,
    events: []
  })

  // Register hooks
  app.service(productsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(), 
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(productExternalResolver),
        schemaHooks.resolveResult(productResolver)
      ]
    },
    before: {
      all: [
        schemaHooks.validateQuery(productQueryValidator),
        schemaHooks.resolveQuery(productQueryResolver)
      ],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(productDataValidator),
        schemaHooks.resolveData(productDataResolver)
      ],
      patch: [
        schemaHooks.validateData(productPatchValidator),
        schemaHooks.resolveData(productPatchResolver)
      ],
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
// We'll clean that up in declarations.ts.
```

---

## 6 Service in declarations.ts registrieren

**Datei:** `apps/api-edge/src/declarations.ts`

```typescript
// ... andere Services
import { products } from './services/products/products'

export interface ServiceTypes {
  // ... andere Services
  products: ProductsService
}
```

---

## 7 Service in Index registrieren

**Datei:** `apps/api-edge/src/services/index.ts`

```typescript
import { products } from './products/products'

export const services = (app: Application) => {
  // ... andere Services
  app.configure(products)
}
```

---

## Checkliste

- [ ] Service mit Feathers CLI generiert
- [ ] Domain Schema in `libs/domains/<service>/domain` erstellt
- [ ] Schema in `tsconfig.base.json` registriert
- [ ] `<service>.class.ts` angepasst (Domain Import)
- [ ] `<service>.schema.ts` angepasst (Domain Import + Resolver)
- [ ] `<service>.ts` angepasst (Factory Pattern)
- [ ] **`authorize()` Hook hinzugefügt**
- [ ] **`multiTenancy()` Hook hinzugefügt**
- [ ] **`generateId()` Hook hinzugefügt**
- [ ] Service in `declarations.ts` deklariert
- [ ] Service in `services/index.ts` registriert
- [ ] Service getestet

---

## Wichtige Hooks

### `authorize()`
Prüft Zugriffsrechte basierend auf Benutzerrollen und Permissions.

### `multiTenancy({ isolateLocation: true, allowGlobalData: false })`
- `isolateLocation: true` → User sieht nur Daten seiner Location
- `allowGlobalData: false` → Keine location-übergreifenden Daten

---

## Weitere Infos

- **Factory Pattern:** `libs/shared/data-access/src/lib/service.factory.ts`
- **FeathersJS Docs:** https://feathersjs.com
- **TypeBox Schema:** https://github.com/sinclairzx81/typebox
