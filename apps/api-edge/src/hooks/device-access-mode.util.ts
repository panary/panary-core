// Aufloesung des erlaubten Personenkreises eines Geraets
// (PNRY-FEAT-DEVICE-ASSIGNMENT-001).
//
// Geteilt vom `userQueryResolver` (Scoping von users.find/get) und vom
// restrict-device-access-mode-Hook (verifyPin/changePin). Die fachlichen Regeln
// liegen in @panary/devices/domain (device-access-mode.ts) — hier steht
// ausschliesslich die Feathers-Mechanik: Actor auflesen, Geraete-Datensatz und
// Exempt-User laden.
//
// Kein Cache: Die Aufloesung laeuft pro Login-Screen und pro PIN-Eingabe, nicht
// pro Bon. Zwei SQLite-Reads dafuer sind billiger als jede Invalidierungslogik,
// die bei einer Zuweisungs-Aenderung falsch liegen koennte.
import { Forbidden } from '@feathersjs/errors'

import {
  DEVICE_ACCESS_EXEMPT_ROLES,
  isDeviceAssigned,
  resolveAssignedUserIds,
  type DeviceAccessState,
} from '@panary/devices/domain'
import { logger } from '@panary/shared-backend'
import type { UserSystemRole } from '@panary/users/domain'

import { resolveActorDeviceId } from './restrict-device-self-patch.hook'

import type { HookContext } from '../declarations'

const DEVICE_ROLE_PREFIX = 'device:'

/**
 * Obergrenze fuer die Exempt-User-Abfrage. Der Kreis sind Inhaber, Filialleiter
 * und Techniker — dreistellig waere schon ungewoehnlich. Die Grenze schuetzt
 * nur davor, bei einem Datenfehler die halbe Tabelle zu laden.
 */
const EXEMPT_USER_LIMIT = 200

const asArray = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : ((result as { data?: T[] } | undefined)?.data ?? [])

/**
 * Feld auf `context.params`, unter dem der aufgeloeste Personenkreis fuer die
 * Dauer des Requests liegt. `null` heisst „keine Einschraenkung".
 */
const SCOPE_PARAM = 'deviceAccessScope'

interface ScopedParams {
  [SCOPE_PARAM]?: string[] | null
}

/**
 * Before-Hook (`before.all` im users-Service): loest den erlaubten
 * Personenkreis EINMAL pro Request auf und legt ihn auf `context.params` ab.
 *
 * Warum ein Hook und nicht direkt im Query-Resolver: Feathers verpackt jeden
 * Fehler aus `resolveQuery` in ein `BadRequest('Error resolving data')` und
 * schiebt das Original nach `error.data.<feld>`. Der Fail-closed-Fall kaeme
 * beim Client also als 400 mit unbrauchbarer Meldung an statt als 403 — im
 * Integrationstest nachgewiesen. Der Hook wirft sauber durch, der Resolver
 * liest nur noch das Ergebnis.
 *
 * Nebeneffekt und eigentlicher Gewinn: `userQueryResolver` und der
 * verifyPin/changePin-Hook teilen sich dieselbe Aufloesung, statt sie
 * nacheinander zweimal zu machen.
 */
export const resolveDeviceAccessScope = async (context: HookContext): Promise<HookContext> => {
  ;(context.params as ScopedParams)[SCOPE_PARAM] = await loadAllowedUserIds(context)
  return context
}

/**
 * Liest den bereits aufgeloesten Personenkreis. `null` heisst „unveraendert
 * durchlassen", eine leere Liste heisst „niemand". Setzt voraus, dass
 * `resolveDeviceAccessScope` im selben Request gelaufen ist — ohne den Hook
 * gaebe es keine Einschraenkung, deshalb ist `null` auch der Default.
 */
export const getDeviceAccessScope = (context: HookContext): string[] | null => readDeviceAccessScope(context.params)

/**
 * Dasselbe fuer Aufrufer, die nur `params` haben statt eines HookContext — die
 * Custom-Methods des users-Service (checkin/checkout/startBreak/endBreak,
 * panary/panary-core#189) bekommen `params` direkt herein und nie einen
 * Context. Eigener Export statt `params.deviceAccessScope` an der Aufrufstelle,
 * damit der Feldname genau hier definiert bleibt.
 */
export const readDeviceAccessScope = (params: unknown): string[] | null =>
  (params as ScopedParams | undefined)?.[SCOPE_PARAM] ?? null

/**
 * Liefert die User-IDs, die sich an diesem Geraet anmelden duerfen — oder
 * `null`, wenn es keine Einschraenkung gibt (interner Aufruf, Nicht-Geraete-
 * Rolle oder `shared`-Geraet).
 *
 * Fail-closed: Laesst sich die Geraete-Identitaet nicht aufloesen oder gibt es
 * keinen Datensatz dazu, wird abgelehnt statt die volle Liste auszuliefern.
 * Beide Faelle sind Anomalien — `allowApiKey` und die Print-Server-Middleware
 * setzen bei jeder Geraete-Rolle sowohl `deviceId` als auch `tenantId`.
 */
const loadAllowedUserIds = async (context: HookContext): Promise<string[] | null> => {
  if (!context.params.provider) return null

  const actor = context.params.user as { role?: string; tenantId?: string } | undefined
  if (!actor?.role?.startsWith(DEVICE_ROLE_PREFIX)) return null

  const deviceId = resolveActorDeviceId(context)
  if (!deviceId || !actor.tenantId) {
    logger.warn({
      message: 'Geraete-Rolle ohne aufloesbare Identitaet — Zugriff verweigert',
      event: 'security.device_identity_missing',
      userRole: actor.role,
      service: context.path,
      method: context.method,
      hasDeviceId: !!deviceId,
      hasTenantId: !!actor.tenantId,
    })
    throw new Forbidden('Geraete-Identitaet konnte nicht ermittelt werden.')
  }

  const device = await loadDeviceRecord(context, deviceId, actor.tenantId)
  if (!device) {
    logger.warn({
      message: 'Kein Geraete-Datensatz zur authentifizierten deviceId — Zugriff verweigert',
      event: 'security.device_record_missing',
      deviceId,
      tenantId: actor.tenantId,
      service: context.path,
      method: context.method,
    })
    throw new Forbidden('Geraet ist nicht registriert.')
  }

  if (!isDeviceAssigned(device)) return null

  const exemptIds = await loadExemptUserIds(context, actor.tenantId)
  return [...new Set([...resolveAssignedUserIds(device), ...exemptIds])]
}

const loadDeviceRecord = async (
  context: HookContext,
  deviceId: string,
  tenantId: string,
): Promise<DeviceAccessState | undefined> => {
  // tenantId explizit: der interne Aufruf traegt keinen User, `multiTenancy`
  // stempelt hier also NICHT — ohne den Filter waere die deviceId global.
  const result = await context.app.service('devices').find({
    query: { deviceId, tenantId, $limit: 1 },
    provider: undefined,
  })
  return asArray<DeviceAccessState>(result)[0]
}

const loadExemptUserIds = async (context: HookContext, tenantId: string): Promise<string[]> => {
  // 🚨 Dieselbe Falle wie oben, und hier die gefaehrlichere: ohne explizite
  // tenantId liefert dieser Aufruf die Freigabe-Berechtigten ALLER Mandanten,
  // und der Login-Screen eines Kunden zeigte fremde Namen.
  const result = await context.app.service('users').find({
    query: {
      // Cast, weil DEVICE_ACCESS_EXEMPT_ROLES bewusst String-Literale haelt
      // (die devices-Domain darf die users-Domain nicht importieren). Dass
      // jeder Wert eine echte UserSystemRole ist, lockt der Invarianten-Test
      // in device-access-exempt-roles.spec.ts.
      role: { $in: [...DEVICE_ACCESS_EXEMPT_ROLES] as UserSystemRole[] },
      tenantId,
      $limit: EXEMPT_USER_LIMIT,
    },
    provider: undefined,
  })
  return asArray<{ _id?: string }>(result)
    .map(user => user._id)
    .filter((id): id is string => typeof id === 'string')
}
