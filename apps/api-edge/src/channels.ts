// For more information about this file see https://dove.feathersjs.com/api/channels.html
import type { Params, RealTimeConnection } from '@feathersjs/feathers'
import type { AuthenticationResult } from '@feathersjs/authentication'
import '@feathersjs/transport-commons'
import type { Application, HookContext } from './declarations'
import { logger } from '@panary/shared-backend'
import { stampApiKeyLastUsed } from './utils/apikey-last-used'
import { authenticateDeviceApiKey } from './utils/device-apikey-auth'
import {
  evaluateDeviceReverification,
  recordReverificationRequired,
  type DeviceReverificationConnectionState,
} from './utils/device-reverification'

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
        // Lookup, Karenz, Promotion und Ausstellung liegen gemeinsam mit dem
        // Print-Server-Pfad in `authenticateDeviceApiKey` (ADR 0042) — zwei
        // Pruefstellen mit getrennten Regeln waeren zwei Gelegenheiten, ein
        // Geraet mitten in der Schicht auszusperren.
        const auth = await authenticateDeviceApiKey(app, {
          rawKey: handshakeAuth.apiKey as string,
          deviceId: handshakeAuth.deviceId as string,
          transport: 'websocket',
          // Der Handshake ist die einzige Stelle, an der ein neuer Schluessel
          // beim Client ankommt (`device:key-rotated`).
          canIssue: true,
        })

        if (auth.ok) {
          const apiKeyRecord = auth.record
          logger.info({
            message: 'Device authenticated via API key',
            event: 'device.auth',
            status: 'success',
            deviceId: handshakeAuth.deviceId,
            tenantId: apiKeyRecord.tenantId,
            locationId: apiKeyRecord.locationId,
            deviceRole: apiKeyRecord.role,
            keyState: auth.state,
            transport: 'websocket',
          })

          // Re-Verifikation VOR dem Stempel bewerten (panary/panary-core#325):
          // `stampApiKeyLastUsed` setzt `lastUsedAt` gleich auf jetzt, danach
          // waere die Pause nicht mehr messbar. Eine gleichzeitige
          // Schluessel-Rotation (ADR 0042) faellt nicht ins Gewicht — sie fasst
          // `lastUsedAt` nicht an.
          //
          // Der Faelligkeits-Zustand selbst liegt persistent auf dem Schluessel
          // (`reverifyOfflineSince`), nicht in dieser Auswertung: Sonst haette ihn
          // der Stempel drei Zeilen weiter unten beim naechsten Reconnect
          // stillschweigend geloescht (ADR 0043).
          const reverification = await evaluateDeviceReverification(app, apiKeyRecord, Date.now(), { persist: true })

          // Device-Auth-Daten auf der Connection speichern,
          // damit der allowApiKey-Hook sie in params kopieren kann
          ;(connection as any).apiKey = true
          ;(connection as any).tenantId = apiKeyRecord.tenantId
          ;(connection as any).locationId = apiKeyRecord.locationId
          ;(connection as any).deviceId = apiKeyRecord.deviceId
          ;(connection as any).deviceRole = apiKeyRecord.role
          // Die Freigabe muss `lastUsedAt` genau dieses Schluessels stempeln;
          // ohne die Id haette sie nur die deviceId und muesste erneut suchen.
          ;(connection as DeviceReverificationConnectionState).apiKeyId = apiKeyRecord._id
          ;(connection as DeviceReverificationConnectionState).requiresReverification = reverification.due
          ;(connection as DeviceReverificationConnectionState).reverificationOfflineSince = reverification.due
            ? (apiKeyRecord.lastUsedAt ?? null)
            : null
          ;(connection as DeviceReverificationConnectionState).reverificationOfflineForMs = reverification.due
            ? reverification.offlineForMs
            : null
          ;(connection as DeviceReverificationConnectionState).reverificationThresholdMs = reverification.thresholdMs

          app.channel('authenticated').join(connection)
          // Live-Verbindungs-Tracking: lastSeen bei Connect stempeln (Disconnect
          // siehe app.on('disconnect') unten). Der device-connections-Service
          // zählt verbundene Geräte live aus der Channel-Registry.
          stampDeviceLastSeen(app, apiKeyRecord.deviceId)
          // Credential-Nutzung getrennt vom Geraet stempeln: `devices.lastSeen`
          // beantwortet „wann war das Geraet zuletzt da", `apikeys.lastUsedAt`
          // „wird dieser Schluessel noch benutzt" (Revocation-Hygiene im Admin).
          //
          // Auch bei faelliger Re-Verifikation wird gestempelt: `lastUsedAt`
          // beantwortet „wird dieser Schluessel noch benutzt" und ist keine
          // Buchung auf die Bestaetigung. Ungefaehrlich ist das nur, weil die
          // Faelligkeit an `reverifyOfflineSince` haengt und nicht an diesem
          // Feld — der Print-Server-Pfad stempelt `lastUsedAt` ohnehin
          // unabhaengig vom Socket und koennte einen abgeleiteten Zustand
          // jederzeit loeschen.
          stampApiKeyLastUsed(app, apiKeyRecord._id)
          socket.emit('device:authenticated', {
            success: true,
            deviceId: handshakeAuth.deviceId,
            // Der Client zeigt daraufhin den Bestaetigungsbildschirm. Die
            // Durchsetzung haengt NICHT daran — sie sitzt serverseitig im
            // requireDeviceReverification-Hook. Wer den Schluessel hat, spricht
            // ohnehin direkt mit dem Socket.
            requiresReverification: reverification.due,
            offlineSince: reverification.due ? (apiKeyRecord.lastUsedAt ?? null) : null,
          })

          // Nur der AUSLOESENDE Handshake schreibt das Audit-Event. Ein
          // wartendes Terminal reconnected beliebig oft (WLAN, Neustart); je
          // Reconnect einen Eintrag zu schreiben machte die eine Meldung, wegen
          // der der Trail existiert, im Rauschen unfindbar.
          if (reverification.due && !reverification.alreadyPending) {
            // Nach dem Emit: Der Bildschirm soll nicht auf einem DB-Write warten.
            void recordReverificationRequired(app, apiKeyRecord, reverification)
          }

          // NACH `device:authenticated`: Der Client soll den neuen Schluessel
          // erst uebernehmen, wenn die Verbindung steht. Er ersetzt damit ein
          // Feld in seiner DeviceConfig — kein Reload, kein Logout. Der alte
          // Schluessel bleibt gueltig, bis der neue zum ersten Mal ankommt.
          if (auth.rotatedKey) {
            socket.emit('device:key-rotated', {
              deviceId: apiKeyRecord.deviceId,
              apiKey: auth.rotatedKey,
              validUntil: auth.rotatedValidUntil,
            })
            logger.info({
              message: 'Neuer Geraete-Schluessel ausgestellt und zugestellt',
              event: 'device.key_rotated',
              status: 'issued',
              deviceId: apiKeyRecord.deviceId,
              tenantId: apiKeyRecord.tenantId,
              apiKeyId: apiKeyRecord._id,
              keyState: auth.state,
              transport: 'websocket',
            })
          }
        } else {
          logger.warn({
            message: 'Invalid or inactive API key',
            event: 'device.auth',
            status: 'rejected',
            reason: auth.reason,
            deviceId: handshakeAuth.deviceId,
            transport: 'websocket',
          })
          // Stabiler Code statt Fliesstext: Der POS-Client unterscheidet daran,
          // ob er „im Admin pruefen, ob das Geraet noch aktiv ist" oder „neu
          // koppeln" anzeigt — zwei grundverschiedene Wege zurueck.
          socket.emit('device:authenticated', {
            success: false,
            error: auth.reason === 'expired' ? 'DEVICE_KEY_EXPIRED' : 'DEVICE_REJECTED',
          })
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
    const recordTenantId = records.find((r: any) => typeof r?.tenantId === 'string' && r.tenantId.length > 0)?.tenantId
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
    return app.channel('authenticated').filter(connection => (connection as any).tenantId === tenantId)
  })
}
