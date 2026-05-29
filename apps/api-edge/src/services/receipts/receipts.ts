// Edge-Service für persistente Belege (§146a AO). Belege sind edge-originated,
// immutable ausgestellte Artefakte; erzeugt vom issue-receipt-Hook (orders →
// completed). Persistenz ausschließlich über die Feathers-Adapter-API.
import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import {
  authorize,
  multiTenancy,
  dataValidator,
  queryValidator,
  getJsonFieldHooks,
  ensureIndexes,
} from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  type Receipt,
  receiptDataSchema,
  receiptPatchSchema,
  receiptQuerySchema,
  receiptSchema,
} from '@panary/receipts/domain'

import type { Application, HookContext } from '../../declarations'

export const receiptsPath = 'receipts'
export const receiptsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

const RECEIPT_JSON_FIELDS = ['lineItems', 'taxSummary', 'seller', 'tse', 'channelsUsed']

const receiptDataValidator = getValidator(receiptDataSchema, dataValidator)
const receiptPatchValidator = getValidator(receiptPatchSchema, dataValidator)
const receiptQueryValidator = getValidator(receiptQuerySchema, queryValidator)

const receiptResolver = resolve<Receipt, HookContext>({})
const receiptExternalResolver = resolve<Receipt, HookContext>({})
const receiptQueryResolver = resolve<Receipt, HookContext>({})

const receiptDataResolver = resolve<Receipt, HookContext>({
  // Offline-First: die _id (uuidv7) wird vom issue-receipt-Hook erzeugt und mit
  // dem Token verknüpft — hier nur Fallback, falls ohne _id angelegt wird.
  _id: async value => value || uuidv7(),
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})

// Belege sind immutable: identifizierende + fiskalische Felder dürfen per PATCH
// nicht überschrieben werden. Veränderbar bleiben nur Lifecycle-/Auslieferungs-
// felder (status, channelsUsed, retainUntil, voidedReceiptId, _deletedAt).
const receiptPatchResolver = resolve<Receipt, HookContext>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  orderId: async () => undefined,
  issuedAt: async () => undefined,
  receiptNumber: async () => undefined,
  lineItems: async () => undefined,
  taxSummary: async () => undefined,
  totalGross: async () => undefined,
  seller: async () => undefined,
  tse: async () => undefined,
  token: async () => undefined,
  renderHash: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
})

export const receipts = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  }

  const service = createServiceAdapter<Receipt>(app, {
    name: receiptsPath,
    Model,
    paginate,
    id: '_id',
    multi: [],
  })

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'receipts',
      [
        { name: 'idx_receipts_tenant', columns: ['tenantId'] },
        { name: 'idx_receipts_tenant_location', columns: ['tenantId', 'locationId'] },
        { name: 'idx_receipts_order', columns: ['orderId'] },
        { name: 'idx_receipts_token', columns: ['token'] },
        { name: 'idx_receipts_created_at', columns: ['createdAt'] },
      ],
      service,
    )

  app.use(receiptsPath, service as any, {
    methods: receiptsMethods,
    events: [],
    docs: {
      description: 'Persistente Belege (Kassenbons, §146a AO)',
      schemas: {
        receipt: receiptSchema,
        receiptData: receiptDataSchema,
        receiptPatch: receiptPatchSchema,
        receiptQuery: receiptQuerySchema,
      },
    },
  })

  const jsonHooks = getJsonFieldHooks(app, RECEIPT_JSON_FIELDS)

  app.service(receiptsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),
        schemaHooks.resolveExternal(receiptExternalResolver),
        schemaHooks.resolveResult(receiptResolver),
      ],
    },
    before: {
      all: [schemaHooks.validateQuery(receiptQueryValidator), schemaHooks.resolveQuery(receiptQueryResolver)],
      create: [
        schemaHooks.validateData(receiptDataValidator),
        schemaHooks.resolveData(receiptDataResolver),
        ...jsonHooks.before,
      ],
      patch: [
        schemaHooks.validateData(receiptPatchValidator),
        schemaHooks.resolveData(receiptPatchResolver),
        ...jsonHooks.before,
      ],
    },
    after: {
      all: [...jsonHooks.after],
    },
    error: { all: [] },
  })
}
