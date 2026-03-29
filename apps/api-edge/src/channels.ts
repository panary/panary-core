// For more information about this file see https://dove.feathersjs.com/api/channels.html
import type { Params, RealTimeConnection } from '@feathersjs/feathers'
import type { AuthenticationResult } from '@feathersjs/authentication'
import '@feathersjs/transport-commons'
import type { Application, HookContext } from './declarations'
import { logger } from './logger'

export const channels = (app: Application) => {
  logger.info({
    message: 'Publishing all events to all authenticated users',
    event: 'channels.configured',
  })

  app.on('connection', async (connection: RealTimeConnection) => {
    // Prüfen ob es sich um eine Device-Verbindung handelt (POS/KDS/Tablet)
    const socket = (connection as any)._socket
    const handshakeAuth = socket?.handshake?.auth

    if (handshakeAuth?.apiKey && handshakeAuth?.deviceId) {
      // --- DEVICE AUTH FLOW ---
      try {
        const result = await app.service('apikeys').find(
          {
            query: {
              apikey: handshakeAuth.apiKey,
              deviceId: handshakeAuth.deviceId,
              $limit: 1,
            },
            provider: undefined,
          }
        ) as { data: any[] } | any[]

        const entries = Array.isArray(result) ? result : (result as any).data ?? []

        if (entries.length > 0 && entries[0].active) {
          const apiKeyRecord = entries[0]
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

      // Add it to the authenticated user channel
      app.channel('authenticated').join(connection)
    }
  })

  // eslint-disable-next-line no-unused-vars
  app.publish((data: any, context: HookContext) => {
    // Here you can add event publishers to channels set up in `channels.js`
    // To publish only for a specific event use `app.publish(eventname, () => {})`

    // e.g. to publish all service events to all authenticated users use
    return app.channel('authenticated')
  })
}
