import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { validateData } from '../../hooks/validate-data.hook'
import { BadRequest } from '@feathersjs/errors'
import { getJsonFieldHooks } from '@panary/shared-backend'

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
import { authorize } from '@panary/shared-backend'
import { multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  preOrderDataSchema,
  preOrderPatchSchema,
  preOrderQuerySchema,
  preOrderSchema,
  PreOrderStatus,
} from '@panary/pre-orders/domain'
import { DineLocation, OrderChannel, OrderStatus, PaymentState } from '@panary/orders/domain'
import type { PreOrder, PreOrderService } from './pre-orders.class'
import { validatePreOrderOpeningHours } from './validate-opening-hours.hook'
import { leadMinutesUntil } from './scheduled-lead-time'
import { assertCallerOwnsRecord, ensureIndexes, logger } from '@panary/shared-backend'

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

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      'pre-orders',
      [
        { name: 'idx_pre-orders_tenant', columns: ['tenantId'] },
        { name: 'idx_pre-orders_tenant_location', columns: ['tenantId', 'locationId'] },
        { name: 'idx_pre-orders_status', columns: ['status'] },
        { name: 'idx_pre-orders_scheduled', columns: ['scheduledFor'] },
      ],
      service,
    )

  // Konvertiert eine Vorbestellung in eine echte Bestellung.
  // Der restrictOrderToBusinessDay-Hook der Order läuft automatisch
  // und übernimmt die Geschäftstag-Zuweisung inkl. Auto-Rotation.
  ;(service as any).convert = async (id: string, params?: any) => {
    // 1. Vorbestellung laden (intern, kein doppelter Auth-Check)
    const preOrder: PreOrder = await app.service('pre-orders').get(id, { provider: undefined })

    // 1a. Gehört sie dem Aufrufer? (#357)
    //
    // 🚨 Muss VOR jedem Write stehen. Feathers rollt nichts zurück: Ein Check
    // nach `orders.create` liesse die Zeile in der Datenbank stehen, und genau
    // daran ist `ensureTenantIsolation` als App-Level-*after*-Hook wirkungslos.
    //
    // Keine der Schichten aus der `around.all`-Kette weiter unten in dieser
    // Datei leistet das hier.
    // `authenticate` und `authorize` greifen zwar auch für `convert`, aber
    // `multiTenancy` schaltet nur auf CRUD-Methodennamen und ist für eine
    // Custom Method ein No-Op — und der `get` darüber läuft ohnehin mit
    // `{ provider: undefined }`, also ungescoped.
    //
    // Gemessen vor dem Fix (2026-09-22, `tenant:staff`): Eine fremde ID
    // antwortete mit HTTP 200, legte eine Order mit den FREMDEN `lineItems` an —
    // auf den EIGENEN Mandanten gestempelt und damit für den Aufrufer lesbar —
    // und markierte die fremde Vorbestellung als CONVERTED.
    assertCallerOwnsRecord(params?.user, preOrder)

    // 2. Statusprüfung
    if (preOrder.status === PreOrderStatus.CONVERTED) {
      throw new BadRequest('Diese Vorbestellung wurde bereits konvertiert.')
    }
    if (preOrder.status === PreOrderStatus.CANCELLED) {
      throw new BadRequest('Eine stornierte Vorbestellung kann nicht konvertiert werden.')
    }

    // Konvertierungszeitpunkt EINMAL bestimmen: `recordingDate` und die daraus
    // abgeleitete Vorlaufzeit müssen denselben Instant benutzen. Zwei getrennte
    // `new Date()` lägen Millisekunden auseinander, und der Bon rechnet
    // `recordingDate + estimatedDuration` — die Differenz landete auf dem Papier.
    const convertedAt = new Date()

    // Die vereinbarte Abholzeit überlebt die Konvertierung als Vorlaufzeit (#344).
    // Vorher stand hier fest 0, und der Bon druckte seit #342 `SOFORT`, obwohl eine
    // Zeit vereinbart war.
    const leadMinutes = leadMinutesUntil(preOrder.scheduledFor, convertedAt)

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
        estimatedDuration: leadMinutes,
        // Spiegelt `order.service.ts`, das beim Anlegen beide Felder auf dieselbe
        // Zahl setzt; die laufende Fortschreibung macht der POS-Client selbst.
        remainingTime: leadMinutes,
        dailySequenceNumber: 0, // Wird von assignDailySequenceNumber überschrieben
        recordingDate: convertedAt.toISOString(),
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
    await app
      .service('pre-orders')
      .patch(id, { status: PreOrderStatus.CONVERTED, convertedOrderId: createdOrder._id }, { provider: undefined })

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

  const jsonHooks = getJsonFieldHooks(app, PRE_ORDER_JSON_FIELDS)

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
        validateData(preOrderDataValidator),
        schemaHooks.resolveData(preOrderDataResolver),
        validatePreOrderOpeningHours,
        ...jsonHooks.before,
      ],
      patch: [
        validateData(preOrderPatchValidator),
        schemaHooks.resolveData(preOrderPatchResolver),
        ...jsonHooks.before,
      ],
      remove: [],
      // convert: keine Schema-Validierung nötig — die ID kommt als primitiver Wert
    },
    after: {
      all: [...jsonHooks.after],
    },
    error: {
      all: [],
    },
  })
}
