// For more information about this file see https://dove.feathersjs.com/api/channels.html
import type { Params, RealTimeConnection } from '@feathersjs/feathers'
import type { AuthenticationResult } from '@feathersjs/authentication'
import '@feathersjs/transport-commons'
import type { Application, HookContext } from './declarations'
import { logger } from '@panary/shared-backend'
import { sha256, timingSafeCompare } from './utils/crypto.utils'

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
    // Interne Aufrufe (kein User-Kontext) → an alle authentifizierten Clients
    if (!context.params.user) {
      return app.channel('authenticated')
    }

    const tenantId = data?.tenantId || context.params.user?.tenantId
    if (!tenantId) {
      return app.channel('authenticated')
    }

    // Events nur an Connections desselben Tenants senden
    return app.channel('authenticated').filter(connection =>
      (connection as any).tenantId === tenantId
    )
  })
}
