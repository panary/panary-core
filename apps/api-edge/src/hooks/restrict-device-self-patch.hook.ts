// Before-Hook fuer den `devices`-Service: PATCH-Self-Restriction.
//
// Duenner Feathers-Adapter um die geteilte Self-Patch-Policy
// (`checkDeviceSelfPatch` aus @panary/devices/domain — Single Source of
// Truth). Whitelist (`SELF_PATCHABLE_DEVICE_FIELDS`), Rollen-Bypass
// (`DEVICE_PRIVILEGED_ROLES`) und Begruendung: siehe device-self-patch-policy.ts.
//
// Ownership: Bei API-Key-Auth (allowApiKey-Hook) traegt der virtuelle User
// `_id: 'device:<deviceId>'`; die rohe deviceId steht zusaetzlich im
// authentication-Payload. Der Ziel-Datensatz wird intern geladen
// (provider: undefined) und dessen deviceId mit der des Actors verglichen —
// context.id ist die `_id` des Datensatzes, nicht die deviceId.
//
// Interne Aufrufe (`provider: undefined`, z.B. lastSeen-Stamping oder die
// apiKeyId-Verknuepfung nach dem Create) sind unbeeintraechtigt.
import { Forbidden } from '@feathersjs/errors'

import {
  checkDeviceSelfPatch,
  DEVICE_PRIVILEGED_ROLES,
  type DeviceSelfPatchActor
} from '@panary/devices/domain'

import type { HookContext } from '../declarations'

const DEVICE_USER_ID_PREFIX = 'device:'

/** Extrahiert die deviceId des authentifizierten Geraets aus den Params.
 *  Auch vom devices-Query-/External-Resolver genutzt (READ-Self-Scoping). */
export const resolveActorDeviceId = (context: HookContext): string | undefined => {
  const payloadDeviceId = (context.params.authentication?.payload as { deviceId?: string } | undefined)
    ?.deviceId
  if (payloadDeviceId) return payloadDeviceId

  const userId = (context.params.user as { _id?: unknown } | undefined)?._id
  if (typeof userId === 'string' && userId.startsWith(DEVICE_USER_ID_PREFIX)) {
    return userId.slice(DEVICE_USER_ID_PREFIX.length)
  }
  return undefined
}

/**
 * Before-Hook fuer `before.patch` im devices-Service. Wird VOR
 * `validateData`/`resolveData` registriert, damit Self-Restriction-Verstoesse
 * frueh fehlschlagen — kein Aufwand fuer Schema-Pruefung wenn das Geraet
 * sowieso nicht patchen darf.
 */
export const restrictDeviceSelfPatch = async (context: HookContext): Promise<HookContext> => {
  // Interne Aufrufe (lastSeen, apiKeyId-Wiring, Service-internal) sind frei.
  if (!context.params.provider) return context

  const user = context.params.user as (DeviceSelfPatchActor & { _id?: string }) | undefined

  // Privilegierte Rollen (devices:MANAGE bzw. PLATFORM_OWNER-Bypass) muessen
  // den Ziel-Datensatz nicht laden — Policy laesst sie ohnehin passieren.
  if (user?.role && DEVICE_PRIVILEGED_ROLES.has(user.role)) return context

  // Multi-Patch (id null) ist fuer non-privilegierte Rollen nie ein Self-Patch.
  if (context.id === null || context.id === undefined) {
    throw new Forbidden('Geraete-Einstellungen koennen nur vom Geraet selbst geaendert werden.')
  }

  // Ziel-Datensatz intern laden, um dessen deviceId zu vergleichen. NotFound
  // laeuft bewusst durch — der eigentliche Patch wuerde identisch scheitern.
  const target = (await context.app.service('devices').get(context.id, { provider: undefined })) as {
    deviceId?: string
  }

  const actor: DeviceSelfPatchActor = {
    role: user?.role,
    deviceId: resolveActorDeviceId(context),
    tenantId: user?.tenantId,
    locationId: user?.locationId
  }

  const violation = checkDeviceSelfPatch(actor, target?.deviceId ?? null, context.data)
  if (violation) {
    throw new Forbidden(violation.message)
  }

  return context
}
