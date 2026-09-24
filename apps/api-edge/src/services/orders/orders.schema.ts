import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary/shared-backend'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  Order,
  orderDataSchema,
  orderPatchSchema,
  OrderQuery,
  orderQuerySchema,
  OrderStatus,
} from '@panary/orders/domain'
import { OrderService } from './orders.class'

//#region 1. Main Resolver (Output)
export const orderResolver = resolve<Order, HookContext<OrderService>>({
  // TODO: Add resolver logic for output here
  // Example: hide fields, resolve relations, etc.
})
export const orderExternalResolver = resolve<Order, HookContext<OrderService>>({
  // TODO: Add resolver logic for external output here
  // Example: Filtering sensitive data
})
//#endregion

//#region 2. Create Resolver (POST)
export const orderDataValidator = getValidator(orderDataSchema, dataValidator)
export const orderDataResolver = resolve<Order, HookContext<OrderService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },

  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  status: async (value, data, context) => {
    return value || OrderStatus.ACTIVE
  },
  creationContext: async (value, data, context) => {
    const rawUserId: string | undefined = (context.params as any)?.user?._id || value?.createdBy
    const rawDeviceId: string | undefined = (context.params as any)?.device?._id || value?.createdVia

    if (!rawUserId && !rawDeviceId) {
      return value
    }

    // "device:<uuid>" → nur die UUID extrahieren
    const stripPrefix = (id: string) => id.replace(/^device:/, '')

    return {
      createdBy: (rawUserId ? stripPrefix(rawUserId) : value?.createdBy) as string,
      createdVia: rawDeviceId ? stripPrefix(rawDeviceId) : value?.createdVia,
    }
  },
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)
/** Kommt dieser Patch aus `orders.split`? Siehe Kommentar an `splitOff` unten. */
function isOrderSplitCall(context: HookContext<OrderService>): boolean {
  const params = context.params as { provider?: string; orderSplit?: boolean }
  return params?.provider === undefined && params?.orderSplit === true
}

export const orderPatchValidator = getValidator(orderPatchSchema, dataValidator)
export const orderPatchResolver = resolve<Order, HookContext<OrderService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  recordingDate: async () => undefined,
  dailySequenceNumber: async () => undefined,
  // Der Abrechnungskreis ist die Klammer ueber Bestellungen, Split-Belege,
  // Umbuchungen und Stornos — er muss ueber alle hinweg identisch bleiben
  // (DSFinV-K Tz. 2.7.1). Ein Patch, der ihn verschoebe, loeste genau die
  // Zuordnung auf, wegen der es das Feld gibt.
  //
  // ⚠️ Der Strip ist STILL: Der Client bekommt HTTP 200, und nichts passiert.
  // Ein Test darauf muss den Wert NACHLESEN, nicht den Statuscode pruefen.
  settlementScope: async () => undefined,
  lineItems: async () => undefined,
  // Gegenbuchungen des Splits (panary/panary-core#349). Fuer jeden anderen
  // Aufrufer gestrippt — und das ist kein Formalismus: `splitOff` senkt ueber
  // `effectiveLineItems()` das ausgewiesene Brutto UND die Steuer. Ein Client,
  // der es selbst setzen koennte, rabattierte seine eigene Bestellung an der
  // Rabattlogik vorbei.
  //
  // Freigegeben nur fuer `orders.split`: `provider === undefined` (interner
  // Aufruf) UND `params.orderSplit === true`. `params` baut der Server —
  // Feathers uebergibt einem externen Aufrufer Query und Route, nie `params`
  // selbst; beide Bedingungen sind von aussen unerreichbar.
  //
  // ⚠️ Der Strip ist STILL: Der Client bekommt HTTP 200, und nichts passiert.
  // Ein Test darauf muss den Wert NACHLESEN, nicht den Statuscode pruefen.
  splitOff: async (value, _data, context) => (isOrderSplitCall(context) ? value : undefined),
  splitRoundingRemainderCents: async (value, _data, context) => (isOrderSplitCall(context) ? value : undefined),
  updatedAt: async () => new Date().toISOString(),
})
//#endregion

// --- 4. Query Resolver (GET) ---
export const orderQueryValidator = getValidator(orderQuerySchema, queryValidator)
export const orderQueryResolver = resolve<OrderQuery, HookContext<OrderService>>({
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
