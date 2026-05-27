import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import { dataValidator, queryValidator } from '@panary/shared-backend'
import {
  CashSession,
  cashSessionDataSchema,
  cashSessionPatchSchema,
  CashSessionQuery,
  cashSessionQuerySchema,
  cashSessionSchema,
  CashSessionStatus,
} from '@panary/businessdays/domain'

import type { HookContext } from '../../declarations'
import { CashSessionService } from './cash-sessions.class'
import { PRIVILEGED_CASH_SESSION_ROLES } from '../../hooks/restrict-cash-session-to-owner.hook'

type Ctx = HookContext<CashSessionService>

// Sync-replikative Aufrufe (Pull-Apply / Bootstrap) setzen `params.fromSync`.
const isFromSync = (context: Ctx): boolean =>
  Boolean((context.params as { fromSync?: boolean }).fromSync)

// Aktueller User aus den Params (Service-Params-Typ kennt `user` nicht direkt).
const ctxUser = (context: Ctx): { _id?: string; role?: string } | undefined =>
  (context.params as { user?: { _id?: string; role?: string } }).user

/**
 * Schützt ein server-/cloud-verwaltetes Feld vor EXTERNEN Writes (provider
 * gesetzt, kein Sync). Interne Aufrufe (Sync-Apply, recompute, Auto-Open mit
 * `provider: undefined`) dürfen den Wert schreiben — so überschreibt der
 * Cloud-Pull die abgeleiteten Geld-Felder autoritativ.
 */
const protectExternal =
  <T>() =>
  async (value: T | undefined, _data: unknown, context: Ctx): Promise<T | undefined> =>
    context.params.provider && !isFromSync(context) ? undefined : value

//#region Output-Resolver (keine sensitiven Felder)
export const cashSessionValidator = getValidator(cashSessionSchema, dataValidator)
export const cashSessionResolver = resolve<CashSession, Ctx>({})
export const cashSessionExternalResolver = resolve<CashSession, Ctx>({})
//#endregion

//#region CREATE-Resolver
export const cashSessionDataValidator = getValidator(cashSessionDataSchema, dataValidator)
export const cashSessionDataResolver = resolve<CashSession, Ctx>({
  // Offline-First: clientseitig generierte _id akzeptieren, sonst neue.
  _id: async value => value || uuidv7(),
  // Sync-Apply bringt den vollen Cloud-Record → Stamping überspringen.
  status: async (value, _data, ctx) => (isFromSync(ctx) ? value : CashSessionStatus.OPEN),
  // Privilegierte Rollen dürfen die Lade FÜR einen Mitarbeiter eröffnen.
  // STAFF/POS oder fehlende Angabe → eigene userId. Interne Aufrufe
  // (Auto-Open mit provider:undefined) übernehmen den übergebenen Wert.
  openedBy: async (value, _data, ctx) => {
    if (isFromSync(ctx)) return value
    const user = ctxUser(ctx)
    const privileged = !ctx.params.provider || (!!user?.role && PRIVILEGED_CASH_SESSION_ROLES.has(user.role))
    if (value && privileged) return value
    return user?._id ?? 'unknown'
  },
  openedAt: async (value, _data, ctx) => (isFromSync(ctx) ? value : new Date().toISOString()),
  closedAt: async (value, _data, ctx) => (isFromSync(ctx) ? value : value ?? null),
  // Bargeld-Inputs/abgeleitete Felder beim Eröffnen 0-stempeln (Edge-Insert ohne
  // useDefaults), außer bei Sync-Apply (Cloud-Werte behalten).
  cashSalesCents: async (value, _data, ctx) => (isFromSync(ctx) ? value : (value as number) ?? 0),
  cashDropsCents: async (value, _data, ctx) => (isFromSync(ctx) ? value : (value as number) ?? 0),
  payoutsCents: async (value, _data, ctx) => (isFromSync(ctx) ? value : (value as number) ?? 0),
  createdAt: async (value, _data, ctx) => (isFromSync(ctx) ? value : new Date().toISOString()),
  updatedAt: async (value, _data, ctx) => (isFromSync(ctx) ? value : new Date().toISOString()),
})
//#endregion

//#region PATCH-Resolver
export const cashSessionPatchValidator = getValidator(cashSessionPatchSchema, dataValidator)
export const cashSessionPatchResolver = resolve<CashSession, Ctx>({
  _id: protectExternal<string>(),
  tenantId: protectExternal<string>(),
  businessDayId: protectExternal<string>(),
  openedBy: protectExternal<string>(),
  openedAt: protectExternal<string>(),
  createdAt: protectExternal<string>(),
  // Abgeleitete Geld-Felder: extern geschützt. countedClosingFloatCents setzt der
  // recompute-Hook (Edge) NACH dem Resolver; cashSalesCents/expected/variance
  // kommen autoritativ aus der Cloud (Sync-Apply → protectExternal lässt sie durch).
  cashSalesCents: protectExternal<number>(),
  countedClosingFloatCents: protectExternal<number>(),
  expectedClosingFloatCents: protectExternal<number>(),
  varianceCents: protectExternal<number>(),
  updatedAt: async (value, _data, ctx) => (isFromSync(ctx) ? value : new Date().toISOString()),
  // Beim Schließen/Plombieren closedAt/closedBy serverseitig stempeln (extern).
  closedAt: async (value, _data, ctx) => {
    if (isFromSync(ctx)) return value
    const status = (ctx.data as { status?: string } | undefined)?.status
    if (status === CashSessionStatus.CLOSED || status === CashSessionStatus.AUDITED) {
      return value ?? new Date().toISOString()
    }
    return value
  },
  closedBy: async (value, _data, ctx) => {
    if (isFromSync(ctx)) return value
    const status = (ctx.data as { status?: string } | undefined)?.status
    if ((status === CashSessionStatus.CLOSED || status === CashSessionStatus.AUDITED) && !value) {
      return ctxUser(ctx)?._id ?? 'unknown'
    }
    return value
  },
})
//#endregion

//#region QUERY-Resolver
export const cashSessionQueryValidator = getValidator(cashSessionQuerySchema, queryValidator)
export const cashSessionQueryResolver = resolve<CashSessionQuery, Ctx>({})
//#endregion
