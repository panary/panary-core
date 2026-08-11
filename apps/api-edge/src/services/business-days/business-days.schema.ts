import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import {
  type BusinessDay,
  businessDayDataSchema,
  businessDayPatchSchema,
  type BusinessDayQuery,
  businessDayQuerySchema,
  businessDaySchema,
  BusinessDayStatus,
  BusinessDayOperationMode,
} from '@panary/businessdays/domain'

import { LocationOperationMode } from '@panary/locations/domain'
import { dataValidator, logger, queryValidator, resolveUserLocationId } from '@panary/shared-backend'
import type { HookContext } from '../../declarations'
import type { BusinessDayService } from './business-days.class'

export const businessDayValidator = getValidator(businessDaySchema, dataValidator)
export const businessDayResolver = resolve<BusinessDay, HookContext<BusinessDayService>>({
  // isOpen wird konsistent zu status gehalten — falls aus alter DB nur status
  // existiert, leite isOpen ab.
  isOpen: async (value, entity) => (value !== undefined ? value : entity?.status === BusinessDayStatus.OPEN),
})
export const businessDayExternalResolver = resolve<BusinessDay, HookContext<BusinessDayService>>({})

export const businessDayDataValidator = getValidator(businessDayDataSchema, dataValidator)

/**
 * Fiskal-Snapshot des Geschaeftstags — abgeleitet aus der Location, nie aus der
 * Anfrage. `operationMode` entscheidet ueber die TSE-Signierung der Bestellungen
 * (`sign-order-tse.hook.ts`) und ueber den Kassen-Zwang
 * (`restrict-order-to-cash-session.ts`); er war bis panary/panary-core#157 Teil
 * der Create-Payload und damit vom Aufrufer waehlbar: Die Snapshot-Logik sass
 * ausschliesslich in `openDay`, und wer `create` statt `openDay` aufrief,
 * bestimmte selbst, ob sein Geschaeftstag fiskalisiert wird. `create` steht in
 * `businessDaysMethods`, und `DEVICE_POS` hat `MANAGE` auf `BUSINESS_DAYS` — ein
 * Kassen-Token genuegt.
 *
 * Der `cloudManagedHook` verstellt den Pfad zwar bei gepairten Edges, aber nur
 * als Nebenwirkung: Er klaert die Lifecycle-Hoheit zwischen Edge und Cloud, und
 * er ist bewusst fail-open. Ein Standalone-Edge trifft er nie. Ein Schutz, der
 * von der Nebenwirkung eines fremden Guards abhaengt, ist keiner.
 *
 * **fail-safe Richtung `pos-cashier`:** Ist die Location nicht ladbar, wird
 * signiert statt nicht signiert — zu viel Fiskalisierung ist ein Aufwands-,
 * zu wenig ein Rechtsproblem. Gleiche Richtung wie der fruehere Fallback in
 * `openDay` und wie das Cloud-Gegenstueck (panary/panary-cloud#146).
 */
const deriveOperationModeFromLocation = async (
  context: HookContext<BusinessDayService>,
  locationId: string | null | undefined,
): Promise<(typeof BusinessDayOperationMode)[keyof typeof BusinessDayOperationMode]> => {
  if (!locationId) return BusinessDayOperationMode.POS_CASHIER
  try {
    const location = await context.app.service('locations').get(locationId, { provider: undefined })
    const mode = (location as { operationMode?: string } | undefined)?.operationMode
    return mode === LocationOperationMode.ORDERS_ONLY
      ? BusinessDayOperationMode.ORDERS_ONLY
      : BusinessDayOperationMode.POS_CASHIER
  } catch (err) {
    logger.warn({
      message: 'business-days: Location nicht ladbar — Fiskal-Snapshot faellt auf pos-cashier',
      event: 'business_day.operation_mode_fallback',
      locationId,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return BusinessDayOperationMode.POS_CASHIER
  }
}

export const businessDayDataResolver = resolve<BusinessDay, HookContext<BusinessDayService>>({
  _id: async value => value || uuidv7(),
  status: async () => BusinessDayStatus.OPEN,
  isOpen: async () => true,
  openedAt: async () => new Date().toISOString(),
  closedAt: async () => null,
  reportId: async () => null,
  reportErrorMessage: async () => null,
  // Serverseitig aus der Location abgeleitet — der Wert aus der Payload wird
  // bewusst VERWORFEN, nicht nur als Default behandelt.
  //
  // Ohne `fromSync`-Zweig, anders als in der Cloud: Auf dem Edge laeuft dieser
  // Resolver fuer Sync-Applies gar nicht erst — `syncAwareResolveCreate`
  // (`business-days.ts`) uebergibt den Record bei `fromSync` unveraendert, weil
  // dort der volle Lifecycle-Record ankommt. Wer diese Weiche entfernt, muss die
  // Ausnahme hier nachziehen: Ein von der Cloud gepullter Tag traegt seinen
  // Snapshot legitim; ihn lokal aus der AKTUELLEN Betriebsart zu ueberschreiben
  // schriebe Historie um.
  operationMode: async (_value, data, context) => {
    // `BusinessDayParams` deklariert kein `user` — der Wert steht dort trotzdem,
    // gesetzt von `authenticate('jwt')`. Gleiche Stelle, aus der `openDay` liest.
    const user = (context.params as { user?: Record<string, unknown> }).user
    const locationId = (data as { locationId?: string | null }).locationId ?? resolveUserLocationId(user) ?? null
    return deriveOperationModeFromLocation(context, locationId)
  },
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})

export const businessDayPatchValidator = getValidator(businessDayPatchSchema, dataValidator)
export const businessDayPatchResolver = resolve<BusinessDay, HookContext<BusinessDayService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  createdAt: async () => undefined,
  openedAt: async () => undefined,
  operationMode: async () => undefined, // Mode-Snapshot ist unveraenderlich
  updatedAt: async () => new Date().toISOString(),
})

export const businessDayQueryValidator = getValidator(businessDayQuerySchema, queryValidator)
export const businessDayQueryResolver = resolve<BusinessDayQuery, HookContext<BusinessDayService>>({})
