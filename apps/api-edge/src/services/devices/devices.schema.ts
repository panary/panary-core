import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary/shared-backend'
import { uuidv7 } from 'uuidv7'

// Import domain schema
import {
  Device,
  deviceDataSchema,
  devicePatchSchema,
  DeviceQuery,
  deviceQuerySchema,
  DEVICE_PRIVILEGED_ROLES
} from '@panary/devices/domain'
import { Forbidden } from '@feathersjs/errors'
import { DeviceService } from './devices.class'
import { resolveActorDeviceId } from '../../hooks/restrict-device-self-patch.hook'

// READ-Self-Scoping (PNRY-FEAT-POS-UI-SCALE-001): DEVICE_POS hat devices:READ
// nur, um den EIGENEN Record zu finden (uiScale-Persistenz). Nicht-privilegierte
// Rollen duerfen weder fremde Geraete enumerieren noch apiKeyId/metadata sehen.
// Privilegiert = devices:MANAGE laut Policy plus platform:*-Rollen (Bypass-
// Semantik analog multiTenancy).
const isPrivilegedDeviceReader = (context: HookContext): boolean => {
  if (!context.params.provider) return true // interne Aufrufe unveraendert
  const role = (context.params.user as { role?: string } | undefined)?.role
  if (!role) return false
  return role.startsWith('platform:') || DEVICE_PRIVILEGED_ROLES.has(role)
}

//#region 1. Main Resolver (Output)
export const deviceResolver = resolve<Device, HookContext<DeviceService>>({
  // TODO: Add resolver logic for output here
  // Example: hide fields, resolve relations, etc.
})
export const deviceExternalResolver = resolve<Device, HookContext<DeviceService>>({
  // Maschinen-Credentials-Referenz + Netz-/Client-Details nur fuer
  // privilegierte Leser — ein POS-Geraet braucht davon nichts.
  apiKeyId: async (value, device, context) => (isPrivilegedDeviceReader(context) ? value : undefined),
  metadata: async (value, device, context) => (isPrivilegedDeviceReader(context) ? value : undefined)
})
//#endregion

//#region 2. Create Resolver (POST)
export const deviceDataValidator = getValidator(deviceDataSchema, dataValidator)
export const deviceDataResolver = resolve<Device, HookContext<DeviceService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },
  deviceId: async () => uuidv7(),
  active: async () => true,

  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
  createdBy: async (value, data, context) => {
    return (context.params as any)?.user?.loginname || 'system'
  }
})
//#endregion

//#region 3. Patch User Resolver (Update / PATCH)
export const devicePatchValidator = getValidator(devicePatchSchema, dataValidator)
export const devicePatchResolver = resolve<Device, HookContext<DeviceService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  deviceId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString()
})
//#endregion

// --- 4. Query Resolver (GET) ---
export const deviceQueryValidator = getValidator(deviceQuerySchema, queryValidator)
export const deviceQueryResolver = resolve<DeviceQuery, HookContext<DeviceService>>({
  // READ-Self-Scoping: nicht-privilegierte Leser (insb. DEVICE_POS) werden
  // hart auf die eigene deviceId gezwungen — greift fuer find UND get (der
  // Adapter matcht die Query auch beim get-by-id). Fail-closed: ohne
  // ableitbare Geraete-Identitaet gibt es keinen devices-Read.
  deviceId: async (value, query, context) => {
    if (isPrivilegedDeviceReader(context)) return value
    const actorDeviceId = resolveActorDeviceId(context)
    if (!actorDeviceId) {
      throw new Forbidden('Geraete-Daten sind nur fuer das eigene Geraet lesbar.')
    }
    return actorDeviceId
  }
})
//#endregion
