import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, logger, queryValidator } from '@panary/shared-backend'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  CreationContext,
  Order,
  orderDataSchema,
  orderPatchSchema,
  OrderQuery,
  orderQuerySchema,
  OrderStatus,
} from '@panary/orders/domain'
import { OrderService } from './orders.class'
import { mayWriteOrderSplitFields } from '../../hooks/order-split-params'
import { attributedOperatorId, isDeviceSession } from '../../utils/pos-operator-attribution'
import { resolveActorDeviceId } from '../../hooks/restrict-device-self-patch.hook'

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

//#region Geraet der Buchung (panary/panary-core#1303)
type CreationDevice = Pick<CreationContext, 'createdVia' | 'createdViaName'>

/**
 * Geraet und Geraetename einer neuen Bestellung. Die Quelle ist die Session,
 * nie der Body — ein gefaelschtes `createdVia`/`createdViaName` aus dem Request
 * bleibt wirkungslos. Reihenfolge:
 *
 * 1. Split-Teilbeleg: erbt beides von der Quelle (`params.inheritCreationDevice`,
 *    setzt nur `orders.split`). Er gehoert zum urspruenglichen Bon, nicht zur
 *    Kasse, die teilt. Fehlt der Quelle das Feld, fehlt es auch dem Teilbeleg.
 * 2. Pull-Apply (`fromSync`, intern): der Datensatz der Cloud gilt unveraendert,
 *    sonst ginge der Snapshot beim Zurueckziehen einer Order still verloren.
 * 3. Geraete-Session: ID aus der Session, Name per Lookup ueber `deviceId`.
 * 4. Sonst (JWT, interne Aufrufe): `createdVia` aus dem Body wie bisher, nie ein Name.
 *
 * `params` baut der Server; Feathers reicht einem externen Aufrufer nur Query und
 * Route durch. Beide Sonderfaelle sind von aussen unerreichbar.
 */
const resolveCreationDevice = async (
  value: CreationContext | null | undefined,
  context: HookContext<OrderService>,
): Promise<CreationDevice> => {
  const params = context.params as { provider?: string; fromSync?: boolean; inheritCreationDevice?: CreationDevice }
  if (params.inheritCreationDevice) {
    return {
      createdVia: params.inheritCreationDevice.createdVia,
      createdViaName: params.inheritCreationDevice.createdViaName,
    }
  }
  if (!params.provider && params.fromSync === true) {
    return { createdVia: value?.createdVia, createdViaName: value?.createdViaName }
  }
  const sessionDeviceId = resolveActorDeviceId(context as unknown as Parameters<typeof resolveActorDeviceId>[0])
  if (sessionDeviceId) {
    return { createdVia: sessionDeviceId, createdViaName: await lookupDeviceName(context, sessionDeviceId) }
  }
  return { createdVia: value?.createdVia }
}

/**
 * Name des Geraets zum Buchungszeitpunkt. Gesucht wird ueber das Feld `deviceId`,
 * nicht ueber `_id` (Muster `stampDeviceLastSeen` in channels.ts). Ein fehlendes
 * Geraet oder ein Lookup-Fehler laesst nur den Namen weg — ein Bon darf daran
 * nie scheitern.
 */
const lookupDeviceName = async (context: HookContext<OrderService>, deviceId: string): Promise<string | undefined> => {
  try {
    const res = (await context.app.service('devices').find({
      query: { deviceId, $limit: 1 },
      paginate: false,
      provider: undefined,
    } as any)) as Array<{ name?: unknown }> | { data?: Array<{ name?: unknown }> } | undefined
    const rows = Array.isArray(res) ? res : (res?.data ?? [])
    const name = rows[0]?.name
    return typeof name === 'string' && name.length > 0 ? name : undefined
  } catch (err) {
    logger.warn({
      message: 'Geraetename fuer die Bestellung nicht ermittelbar',
      event: 'orders.creation_device_name_lookup_failed',
      deviceId,
      error: String(err),
    })
    return undefined
  }
}

/** Frueher Return ohne Bediener und Geraet: Body-Werte nur ueber `resolveCreationDevice`. */
const withoutDeviceFields = (value: CreationContext, device: CreationDevice): CreationContext => {
  const { createdVia: _via, createdViaName: _name, ...rest } = value
  return {
    ...rest,
    ...(device.createdVia ? { createdVia: device.createdVia } : {}),
    ...(device.createdViaName ? { createdViaName: device.createdViaName } : {}),
  } as CreationContext
}
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
  // 🚨 Dieselbe Sperre wie im Patch-Resolver — der CREATE-Pfad war die Luecke.
  // `orderDataSchema` PICKT die Split-Felder (noetig fuer den Sync-Push, weil
  // `additionalProperties: false` sonst den ganzen Record verwuerfe), und
  // `calculateTaxDetails` laeuft VOR `validateData`/`resolveData`. Ein Client mit
  // `orders:CREATE` konnte damit beim Anlegen ein eigenes `splitOff` mitschicken
  // und bekam eine Bestellung, die von Geburt an weniger Steuer auswies, als ihre
  // eigenen `lineItems` hergeben — ohne dass je ein Split gelaufen waere.
  //
  // Der Strip allein reicht nicht: Er liefe zu spaet. Der Steuer-Hook prueft
  // deshalb dieselbe Bedingung (`calculate-tax-details.ts`).
  splitOff: async (value, _data, context) => (mayWriteOrderSplitFields(context.params) ? value : undefined),
  splitRoundingRemainderCents: async (value, _data, context) =>
    mayWriteOrderSplitFields(context.params) ? value : undefined,
  creationContext: async (value, data, context) => {
    // Geraet (#619, ADR 0053): Bediener aus dem Token, sonst der Body-Wert als
    // „unbelegt“. Vorher stand hier die Geraete-UUID — kein Mensch.
    const isDevice = isDeviceSession((context.params as any)?.user)
    const deviceOperator = isDevice
      ? attributedOperatorId(context.params, value?.createdBy, {
          service: 'orders',
          field: 'creationContext.createdBy',
        })
      : undefined
    // Eine Geraete-Session faellt nie auf `params.user._id` zurueck: Das ist `device:<uuid>`, kein Mensch (#1311).
    const rawUserId: string | undefined = isDevice
      ? deviceOperator
      : (context.params as any)?.user?._id || value?.createdBy
    const device = await resolveCreationDevice(value, context)

    if (!rawUserId && !device.createdVia) {
      return value ? withoutDeviceFields(value, device) : value
    }

    // "device:<uuid>" → nur die UUID extrahieren
    const stripPrefix = (id: string) => id.replace(/^device:/, '')

    return {
      createdBy: (rawUserId ? stripPrefix(rawUserId) : value?.createdBy) as string,
      createdVia: device.createdVia ? stripPrefix(device.createdVia) : undefined,
      ...(device.createdViaName ? { createdViaName: device.createdViaName } : {}),
    }
  },
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)

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
  // Erfassungskontext (Bediener, Geraet, Geraetename) ist ein Snapshot der Anlage
  // (panary/panary-core#1303) und wird nie nachgetragen — auch nicht vom Pull-Apply.
  // `orderPatchSchema` ist `Type.Partial(orderSchema)` und liesse ihn sonst durch.
  //
  // ⚠️ Der Strip ist STILL: Der Client bekommt HTTP 200, und nichts passiert.
  creationContext: async () => undefined,
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
  splitOff: async (value, _data, context) => (mayWriteOrderSplitFields(context.params) ? value : undefined),
  splitRoundingRemainderCents: async (value, _data, context) =>
    mayWriteOrderSplitFields(context.params) ? value : undefined,
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
