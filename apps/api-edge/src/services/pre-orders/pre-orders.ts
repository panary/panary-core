import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { BadRequest } from '@feathersjs/errors'
import { parseJsonFields } from '../../hooks/parse-json-fields.hook'
import { stringifyJsonFields } from '../../hooks/stringify-json-fields.hook'
import { formatDateISO, getOpeningHoursForDate } from '@panary-core/locations/domain'

const PRE_ORDER_JSON_FIELDS = ['lineItems', 'customerContact', 'metadata']

import {
  preOrderDataResolver,
  preOrderDataValidator,
  preOrderExternalResolver,
  preOrderPatchResolver,
  preOrderPatchValidator,
  preOrderQueryResolver,
  preOrderQueryValidator,
  preOrderResolver,
} from './pre-orders.schema'

import type { Application } from '../../declarations'
import { authorize } from '../../hooks/authorize.hook'
import { multiTenancy } from '../../hooks/multi-tenancy.hook'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared/common'
import {
  preOrderDataSchema,
  preOrderPatchSchema,
  preOrderQuerySchema,
  preOrderSchema,
  PreOrderStatus,
} from '@panary-core/pre-orders/domain'
import { DineLocation, OrderChannel, OrderStatus, PaymentState } from '@panary-core/orders/domain'
import type { PreOrder, PreOrderService } from './pre-orders.class'
import { logger } from '../../logger'

export const preOrdersPath = 'pre-orders'
export const preOrdersMethods = ['find', 'get', 'create', 'patch', 'remove', 'convert'] as const

export * from './pre-orders.schema'

export const preOrders = (app: Application) => {
  const paginate = app.get('paginate')

  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any

  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  }

  const service = createServiceAdapter<PreOrder>(app, {
    name: 'pre-orders',
    Model,
    paginate,
    id: '_id',
    multi: [],
  }) as unknown as PreOrderService

  ;(service as any).setup = async (app: Application, _path: string) => {
    const systemConfig = app.get('system') || {}
    const dbType = systemConfig.dbType || DatabaseType.SQLITE

    if (dbType === DatabaseType.SQLITE) {
      const knex = app.get('sqliteClient')
      const tableName = 'pre-orders'

      try {
        const hasTable = await knex.schema.hasTable(tableName)
        if (hasTable) {
          await knex.raw(`CREATE INDEX IF NOT EXISTS "idx_pre-orders_tenant" ON "${tableName}" (tenantId)`)
          await knex.raw(
            `CREATE INDEX IF NOT EXISTS "idx_pre-orders_tenant_location" ON "${tableName}" (tenantId, locationId)`,
          )
          await knex.raw(`CREATE INDEX IF NOT EXISTS "idx_pre-orders_status" ON "${tableName}" (status)`)
          await knex.raw(`CREATE INDEX IF NOT EXISTS "idx_pre-orders_scheduled" ON "${tableName}" (scheduledFor)`)
          logger.info({ message: 'Indexes ensured', event: 'db.indexes', dbType: 'sqlite', service: 'pre-orders' })
        }
      } catch (error) {
        logger.error({
          message: 'Failed to ensure indexes',
          event: 'db.indexes_error',
          dbType: 'sqlite',
          service: 'pre-orders',
          error: String(error),
        })
      }
    }
  }

  // Konvertiert eine Vorbestellung in eine echte Bestellung.
  // Der restrictOrderToBusinessDay-Hook der Order läuft automatisch
  // und übernimmt die Geschäftstag-Zuweisung inkl. Auto-Rotation.
  ;(service as any).convert = async (id: string, params?: any) => {
    // 1. Vorbestellung laden (intern, kein doppelter Auth-Check)
    const preOrder: PreOrder = await app.service('pre-orders').get(id, { provider: undefined })

    // 2. Statusprüfung
    if (preOrder.status === PreOrderStatus.CONVERTED) {
      throw new BadRequest('Diese Vorbestellung wurde bereits konvertiert.')
    }
    if (preOrder.status === PreOrderStatus.CANCELLED) {
      throw new BadRequest('Eine stornierte Vorbestellung kann nicht konvertiert werden.')
    }

    // 3. Order anlegen — hooks (restrictOrderToBusinessDay, assignDailySequenceNumber,
    //    calculateTaxDetails) laufen automatisch über den orders-Service
    const createdOrder = await app.service('orders').create(
      {
        locationId: preOrder.locationId,
        tenantId: preOrder.tenantId,
        status: OrderStatus.ACTIVE,
        orderChannel: OrderChannel.TELEPHONE,
        dineLocation: preOrder.dineLocation || DineLocation.TAKE_OUT,
        lineItems: preOrder.lineItems,
        preOrderId: preOrder._id,
        isFinished: false,
        estimatedDuration: 0,
        remainingTime: 0,
        dailySequenceNumber: 0, // Wird von assignDailySequenceNumber überschrieben
        recordingDate: new Date().toISOString(),
        externalId: null,
        payment: {
          state: PaymentState.PENDING,
          totalAmount: 0,
          tipAmount: 0,
          transactions: [],
        },
      },
      params, // Auth-Context weitergeben (für restrictOrderToBusinessDay / Benutzerkontext)
    )

    // 4. Vorbestellung als konvertiert markieren
    await app.service('pre-orders').patch(
      id,
      { status: PreOrderStatus.CONVERTED, convertedOrderId: createdOrder._id },
      { provider: undefined },
    )

    logger.info({
      message: 'Vorbestellung konvertiert',
      event: 'pre-orders.converted',
      preOrderId: id,
      orderId: createdOrder._id,
    })

    return createdOrder
  }

  app.use(preOrdersPath, service as any, {
    methods: preOrdersMethods,
    events: [],
    docs: {
      description: 'Verwaltung von Vorbestellungen',
      schemas: {
        preOrder: preOrderSchema,
        preOrderData: preOrderDataSchema,
        preOrderPatch: preOrderPatchSchema,
        preOrderQuery: preOrderQuerySchema,
      },
    },
  })

  app.service(preOrdersPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),

        schemaHooks.resolveExternal(preOrderExternalResolver),
        schemaHooks.resolveResult(preOrderResolver),
      ],
    },
    before: {
      all: [schemaHooks.validateQuery(preOrderQueryValidator), schemaHooks.resolveQuery(preOrderQueryResolver)],
      find: [],
      get: [],
      create: [
        schemaHooks.validateData(preOrderDataValidator),
        schemaHooks.resolveData(preOrderDataResolver),
        // Öffnungszeiten-Validierung
        async (context: any) => {
          const data = context.data
          if (!data?.scheduledFor) return context

          const locationId = data.locationId || context.params?.user?.locationId
          if (!locationId) return context

          const location = await app.service('locations').get(locationId, { provider: undefined })
          const ohs = (location as any)?.settings?.openingHoursSettings
          if (!ohs?.enabled) return context

          const scheduledDate = new Date(data.scheduledFor)

          // Ausnahmen laden
          const dateStr = formatDateISO(scheduledDate)
          const excResult = await app.service('opening-hour-exceptions').find({
            query: { date: dateStr, tenantId: data.tenantId },
            provider: undefined,
          }) as any
          const exceptions = Array.isArray(excResult) ? excResult : excResult.data || []

          const hours = getOpeningHoursForDate(scheduledDate, ohs.regular || [], exceptions)
          if (hours.closed) {
            throw new BadRequest('Vorbestellung nicht möglich — der Betrieb ist an diesem Tag geschlossen.')
          }

          if (hours.open && hours.close) {
            const h = scheduledDate.getHours()
            const m = scheduledDate.getMinutes()
            const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
            if (timeStr < hours.open || timeStr > hours.close) {
              throw new BadRequest(
                `Vorbestellung nicht möglich — die Öffnungszeiten sind ${hours.open} bis ${hours.close} Uhr.`,
              )
            }
          }

          return context
        },
        stringifyJsonFields(...PRE_ORDER_JSON_FIELDS),
      ],
      patch: [
        schemaHooks.validateData(preOrderPatchValidator),
        schemaHooks.resolveData(preOrderPatchResolver),
        stringifyJsonFields(...PRE_ORDER_JSON_FIELDS),
      ],
      remove: [],
      // convert: keine Schema-Validierung nötig — die ID kommt als primitiver Wert
    },
    after: {
      all: [parseJsonFields(...PRE_ORDER_JSON_FIELDS)],
    },
    error: {
      all: [],
    },
  })
}
