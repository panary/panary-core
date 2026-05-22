// For more information about this file see https://dove.feathersjs.com/api/channels.html
import type { Params, RealTimeConnection } from '@feathersjs/feathers'
import type { AuthenticationResult } from '@feathersjs/authentication'
import '@feathersjs/transport-commons'
import type { Application, HookContext } from './declarations'
import { logger } from '@panary/shared-backend'
import { sha256, timingSafeCompare } from './utils/crypto.utils'

/**
 * Stempelt `lastSeen` eines Geräts auf jetzt — Connect-/Disconnect-Tracking für
 * die Anzeige „letzte Aktivität". Der Edge-`devices`-Service hat `multi: []`,
 * daher zuerst per `deviceId` finden und dann per `_id` patchen (kein
 * `patch(null, …)`). Interner Call (provider: undefined), fire-and-forget —
 * ein Fehler darf den Socket-Lifecycle nicht beeinflussen.
 *
 * `devices` ist nicht in der Sync-Allowlist → kein Outbox-/Cloud-Push.
 */
const stampDeviceLastSeen = (app: Application, deviceId: string): void => {
  void (async () => {
    try {
      const res = (await app.service('devices').find({
        query: { deviceId, $limit: 1 },
        provider: undefined,
      } as any)) as { data?: Array<{ _id?: string }> } | undefined
      const id = res?.data?.[0]?._id
      if (!id) return
      await app
        .service('devices')
        .patch(id, { lastSeen: new Date().toISOString() } as any, { provider: undefined } as any)
    } catch (err) {
      logger.warn({
        message: 'Failed to stamp device lastSeen',
        event: 'device.last_seen_error',
        deviceId,
        error: String(err),
      })
    }
  })()
}

export const channels = (app: Application) => {
  logger.info({
    message: 'Publishing events with tenant isolation',
    event: 'channels.configured',
  })

  app.on('connection', async (connection: RealTimeConnection) => {
    // Prüfen ob es sich um eine Device-Verbindung handelt (POS/KDS/Tablet)
    const socket = (connection as any)._socket
    const handshakeAuth = socket?.handshake?.auth

    if (handshakeAuth?.apiKey && handshakeAuth?.deviceId) {
      // --- DEVICE AUTH FLOW ---
      try {
        // Lookup direkt via Knex (umgeht Service-Hooks/Validierung/Auth)
        const inputKey = handshakeAuth.apiKey as string
        const inputHash = sha256(inputKey)
        const inputPrefix = inputKey.slice(0, 8)
        const knex = app.get('sqliteClient')

        const candidates = await knex('apikeys')
          .where({ apikeyPrefix: inputPrefix, deviceId: handshakeAuth.deviceId })
          .limit(5)

        // Timing-Safe Hash-Vergleich gegen alle Kandidaten
        const apiKeyRecord = candidates.find(
          (entry: any) => entry.active && timingSafeCompare(inputHash, entry.apikey)
        )

        if (apiKeyRecord) {
          logger.info({
            message: 'Device authenticated via API key',
            event: 'device.auth',
            status: 'success',
            deviceId: handshakeAuth.deviceId,
            tenantId: apiKeyRecord.tenantId,
            locationId: apiKeyRecord.locationId,
            deviceRole: apiKeyRecord.role,
            transport: 'websocket',
          })

          // Device-Auth-Daten auf der Connection speichern,
          // damit der allowApiKey-Hook sie in params kopieren kann
          ;(connection as any).apiKey = true
          ;(connection as any).tenantId = apiKeyRecord.tenantId
          ;(connection as any).locationId = apiKeyRecord.locationId
          ;(connection as any).deviceId = apiKeyRecord.deviceId
          ;(connection as any).deviceRole = apiKeyRecord.role

          app.channel('authenticated').join(connection)
          // Live-Verbindungs-Tracking: lastSeen bei Connect stempeln (Disconnect
          // siehe app.on('disconnect') unten). Der device-connections-Service
          // zählt verbundene Geräte live aus der Channel-Registry.
          stampDeviceLastSeen(app, apiKeyRecord.deviceId)
          socket.emit('device:authenticated', { success: true, deviceId: handshakeAuth.deviceId })
        } else {
          logger.warn({
            message: 'Invalid or inactive API key',
            event: 'device.auth',
            status: 'rejected',
            deviceId: handshakeAuth.deviceId,
            transport: 'websocket',
          })
          socket.emit('device:authenticated', { success: false, error: 'Invalid or inactive API key' })
        }
      } catch (err: any) {
        logger.error({
          message: 'Error validating API key',
          event: 'device.auth',
          status: 'error',
          deviceId: handshakeAuth.deviceId,
          transport: 'websocket',
          error: String(err),
        })
        socket.emit('device:authenticated', { success: false, error: 'Authentication error' })
      }
    } else {
      // Anonyme Verbindung (wartet auf JWT-Login)
      app.channel('anonymous').join(connection)
    }
  })

  // Live-Verbindungs-Tracking: bei Disconnect einer Device-Connection die
  // „letzte Aktivität" (lastSeen) festhalten. Channel-Mitgliedschaft entfernt
  // Feathers automatisch → der device-connections-Zähler stimmt ohne weiteres Zutun.
  app.on('disconnect', (connection: RealTimeConnection) => {
    const deviceId = (connection as any).deviceId
    if (typeof deviceId === 'string' && deviceId) {
      stampDeviceLastSeen(app, deviceId)
    }
  })

  app.on('login', (authResult: AuthenticationResult, { connection }: Params) => {
    // connection can be undefined if there is no
    // real-time connection, e.g. when logging in via REST
    if (connection) {
      // The connection is no longer anonymous, remove it
      app.channel('anonymous').leave(connection)

      // tenantId und locationId auf Connection speichern für Channel-Filterung
      ;(connection as any).tenantId = authResult.user?.tenantId
      ;(connection as any).locationId = authResult.user?.locationId

      // Add it to the authenticated user channel
      app.channel('authenticated').join(connection)
    }
  })

  // eslint-disable-next-line no-unused-vars
  app.publish((data: any, context: HookContext) => {
    // Tenant aus dem Record (interne Sync-Applies tragen tenantId) ODER dem
    // authentifizierten Actor ableiten. Array-sicher (multi-create/patch).
    const records = Array.isArray(data) ? data : data ? [data] : []
    const recordTenantId = records.find(
      (r: any) => typeof r?.tenantId === 'string' && r.tenantId.length > 0
    )?.tenantId
    const tenantId = recordTenantId || context.params.user?.tenantId

    // Kein Tenant ableitbar → NICHTS publishen (kein `authenticated`-Broadcast
    // mehr — Defense-in-Depth gegen Cross-Tenant-Leaks bei Fehlkonfiguration).
    // Edge ist single-tenant/single-location → bewusst KEIN Location-Filter
    // (No-op; und wuerde POS aushungern, da activeLocationId hier nicht
    // gestempelt wird). Sync-Applies (provider:undefined) tragen tenantId und
    // erreichen die POS-Clients weiterhin live.
    if (!tenantId) {
      return
    }

    // Events nur an Connections desselben Tenants senden
    return app.channel('authenticated').filter(connection =>
      (connection as any).tenantId === tenantId
    )
  })
}
