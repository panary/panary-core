import { authenticate } from '@feathersjs/authentication'
import { Forbidden } from '@feathersjs/errors'

import { authorize } from '@panary/shared-backend'
import type { Application } from '../../declarations'

export const deviceConnectionsPath = 'device-connections'

interface ServiceParams {
  user?: { tenantId?: string; role?: string }
  provider?: string
  query?: Record<string, unknown>
}

export interface DeviceConnectionStatus {
  /** Anzahl gerade mit dem Edge verbundener Geräte des Tenants (eindeutige deviceId). */
  online: number
  /** Anzahl registrierter (aktiver) Geräte des Tenants. */
  total: number
  /** deviceId-Liste der gerade verbundenen Geräte (für Live-Badges/Liste). */
  connectedDeviceIds: string[]
}

/**
 * Sammelt die eindeutigen `deviceId`s der gerade verbundenen Geräte EINES Tenants
 * aus der Feathers-Channel-Registry. Device-Connections joinen in `channels.ts`
 * nach erfolgreicher API-Key-Auth den `authenticated`-Channel und tragen
 * `connection.tenantId`/`connection.deviceId`. Idiomatischer als der rohe
 * Socket.IO-Zugriff und automatisch aktuell (Disconnect entfernt die Connection).
 */
function collectConnectedDeviceIds(app: Application, tenantId: string): string[] {
  const channel = typeof app.channel === 'function' ? app.channel('authenticated') : undefined
  const connections = channel?.connections
  if (!Array.isArray(connections)) return []

  const ids = new Set<string>()
  for (const conn of connections) {
    const c = conn as { tenantId?: string; deviceId?: string }
    if (c.tenantId === tenantId && typeof c.deviceId === 'string' && c.deviceId) {
      ids.add(c.deviceId)
    }
  }
  return [...ids]
}

/**
 * Read-only Custom-Service `device-connections`: Echtzeit-Verbindungszählung der
 * Geräte eines Tenants am Edge. `find` liefert `{ online, total, connectedDeviceIds }`.
 * Tenant-Scoping über `params.user.tenantId`; `authorize()` prüft das READ-Recht
 * (RolePermissions: DEVICE_CONNECTIONS → TENANT_OWNER + TENANT_TECHNICIAN).
 */
export const deviceConnectionsService = (app: Application) => ({
  async find(params: ServiceParams = {}): Promise<DeviceConnectionStatus> {
    const tenantId = params.user?.tenantId
    if (params.provider && !tenantId) throw new Forbidden('Tenant-Kontext fehlt.')
    if (!tenantId) return { online: 0, total: 0, connectedDeviceIds: [] }

    const connectedDeviceIds = collectConnectedDeviceIds(app, tenantId)

    // total = aktive (registrierte) Geräte des Tenants. Interner Call
    // (provider: undefined) umgeht den multiTenancy-Filter → tenantId explizit.
    let total = connectedDeviceIds.length
    try {
      const res = await app.service('devices').find({
        query: { tenantId, active: true, $limit: 0 },
        provider: undefined,
      } as never)
      const t = (res as { total?: number } | undefined)?.total
      if (typeof t === 'number') total = t
    } catch {
      // Degradiert auf die Online-Zahl — die Live-Verbindung bleibt korrekt.
    }

    return { online: connectedDeviceIds.length, total, connectedDeviceIds }
  },
})

export const deviceConnections = (app: Application) => {
  // `device-connections` ist nicht in den ServiceTypes deklariert (Custom-
  // Computed-Service, kein DB-Adapter) → `as any` für use/service, analog zur
  // Cloud-Registrierung.
  ;(app as any).use(deviceConnectionsPath, deviceConnectionsService(app), {
    methods: ['find'],
    events: [],
  })
  ;(app as any).service(deviceConnectionsPath).hooks({
    around: {
      all: [authenticate('jwt'), authorize()],
    },
  })
}
