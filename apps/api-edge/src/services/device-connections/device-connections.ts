import { authenticate } from '@feathersjs/authentication'
import { Forbidden } from '@feathersjs/errors'

import { authorize } from '@panary/shared-backend'
import type { Application } from '../../declarations'
import { readClientVersion } from '../../device-client-version'

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
  /**
   * Die verbundenen Geräte samt Client-Version (core#1438, ADR 0070). `clientVersion` ist `null`, wenn
   * das Gerät keine gesendet hat (älterer POS) oder der Wert unbrauchbar war. Gleiche Reihenfolge wie
   * `connectedDeviceIds`. Nur hier, nie in der öffentlichen `/health`: Der Dienst verlangt Anmeldung
   * und das READ-Recht (TENANT_OWNER, TENANT_TECHNICIAN).
   */
  connectedDevices: ConnectedDevice[]
}

export interface ConnectedDevice {
  deviceId: string
  clientVersion: string | null
}

/**
 * Sammelt die eindeutigen verbundenen Geräte EINES Tenants (mit Client-Version) aus der
 * Feathers-Channel-Registry. Device-Connections joinen in `channels.ts` nach erfolgreicher
 * API-Key-Auth den `authenticated`-Channel und tragen `connection.tenantId`/`connection.deviceId`/
 * `connection.clientVersion`. Idiomatischer als der rohe Socket.IO-Zugriff und automatisch aktuell
 * (Disconnect entfernt die Connection).
 *
 * Hält ein Gerät mehrere Verbindungen (Reconnect-Überlappung), zählt es einmal. Die Version ist die
 * der zuletzt registrierten Verbindung, die eine nennt: Die Registry führt sie in Verbindungsreihenfolge, die jüngste
 * Verbindung ist also die aktuelle. Eine versionslose Verbindung überschreibt keine bekannte.
 */
export function collectConnectedDevices(app: Application, tenantId: string): ConnectedDevice[] {
  const channel = typeof app.channel === 'function' ? app.channel('authenticated') : undefined
  const connections = channel?.connections
  if (!Array.isArray(connections)) return []

  const devices = new Map<string, ConnectedDevice>()
  for (const conn of connections) {
    const c = conn as { tenantId?: string; deviceId?: string; clientVersion?: unknown }
    if (c.tenantId !== tenantId || typeof c.deviceId !== 'string' || !c.deviceId) continue
    const clientVersion = readClientVersion(c.clientVersion)
    const known = devices.get(c.deviceId)
    if (!known) devices.set(c.deviceId, { deviceId: c.deviceId, clientVersion })
    else if (clientVersion !== null) known.clientVersion = clientVersion
  }
  return [...devices.values()]
}

/**
 * Read-only Custom-Service `device-connections`: Echtzeit-Verbindungszählung der
 * Geräte eines Tenants am Edge. `find` liefert `{ online, total, connectedDeviceIds, connectedDevices }`.
 * Tenant-Scoping über `params.user.tenantId`; `authorize()` prüft das READ-Recht
 * (RolePermissions: DEVICE_CONNECTIONS → TENANT_OWNER + TENANT_TECHNICIAN).
 */
export const deviceConnectionsService = (app: Application) => ({
  async find(params: ServiceParams = {}): Promise<DeviceConnectionStatus> {
    const tenantId = params.user?.tenantId
    if (params.provider && !tenantId) throw new Forbidden('Tenant-Kontext fehlt.')
    if (!tenantId) return { online: 0, total: 0, connectedDeviceIds: [], connectedDevices: [] }

    const connectedDevices = collectConnectedDevices(app, tenantId)
    const connectedDeviceIds = connectedDevices.map(d => d.deviceId)

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

    return { online: connectedDeviceIds.length, total, connectedDeviceIds, connectedDevices }
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
