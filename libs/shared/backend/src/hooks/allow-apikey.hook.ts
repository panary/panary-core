import type { HookContext, NextFunction } from '../declarations'
import { logger } from '../logger'

/**
 * Around-Hook: Erlaubt API-Key-authentifizierten Device-Verbindungen den Zugriff auf Services.
 *
 * Problem: Devices verbinden sich via WebSocket mit apiKey + deviceId. Die channels.ts
 * validiert den Key und speichert Auth-Daten auf der Connection. Aber der `authenticate('jwt')`-
 * Hook auf den Services erwartet einen JWT-Token und lehnt Device-Verbindungen mit 401 ab.
 *
 * Lösung: Dieser Hook läuft VOR authenticate('jwt') (als App-Level-Hook) und:
 * 1. Erkennt API-Key-authentifizierte Connections (connection.apiKey === true)
 * 2. Setzt params.authenticated = true → Feathers skippt die JWT-Prüfung
 * 3. Erstellt einen virtuellen params.user → authorize() und multiTenancy() funktionieren
 *
 * MUSS als erster Hook in app.hooks({ around: { all: [...] } }) registriert werden.
 */
export const allowApiKey = () => {
  return async (context: HookContext, next: NextFunction) => {
    const { params } = context

    // Nur für externe Aufrufe mit einer Connection (WebSocket)
    if (params.provider && params.connection) {
      const conn = params.connection as any

      if (conn.apiKey === true && conn.deviceRole) {
        // Connection wurde in channels.ts via API-Key authentifiziert
        context.params.authenticated = true

        context.params.authentication = {
          strategy: 'apiKey',
          authenticated: true,
          payload: {
            apiKey: true,
            tenantId: conn.tenantId,
            locationId: conn.locationId,
            deviceId: conn.deviceId,
          },
        }

        // Virtuellen User für authorize() und multiTenancy() setzen
        context.params.user = {
          _id: `device:${conn.deviceId}`,
          role: conn.deviceRole,
          tenantId: conn.tenantId,
          locationId: conn.locationId,
          activeLocationId: conn.locationId,
          allowedLocationIds: [conn.locationId],
        } as any

        logger.debug(
          `[AllowApiKey] Device ${conn.deviceId} (${conn.deviceRole}) → Service: ${context.path}/${context.method}`,
        )
      }
    }

    await next()
  }
}
