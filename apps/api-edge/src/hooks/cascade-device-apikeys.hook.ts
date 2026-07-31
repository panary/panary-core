import { logger } from '@panary/shared-backend'

import type { HookContext } from '../declarations'

interface CascadeDeviceInfo {
  deviceId?: string
  apiKeyId?: string
}

interface CascadeParams {
  cascadeDevice?: CascadeDeviceInfo
}

/** Obergrenze fuer die Kaskade — ein Geraet hat normal genau einen Schluessel. */
const MAX_CASCADE_KEYS = 25

/**
 * `before.remove`: merkt sich `deviceId` und `apiKeyId` des zu loeschenden
 * Geraets auf `context.params`.
 *
 * Noetig, weil `before.remove` nur `context.id` kennt — nach dem Loeschen ist der
 * Record weg und die Rueckwaerts-Referenz `apikeys.deviceId` nicht mehr
 * aufloesbar. `captureAuditBefore` hilft hier nicht: `devices` steht nicht in
 * AUDIT_RESOURCE_MAP, der Hook steigt vorher aus.
 */
export const captureDeviceForCascade = async (context: HookContext): Promise<HookContext> => {
  if (context.id === null || context.id === undefined) return context

  try {
    const device = (await context.app.service('devices').get(context.id, { provider: undefined } as never)) as {
      deviceId?: string
      apiKeyId?: string
    }
    ;(context.params as CascadeParams).cascadeDevice = {
      deviceId: device?.deviceId,
      apiKeyId: device?.apiKeyId,
    }
  } catch (err) {
    // Degradieren statt abbrechen: der eigentliche remove scheitert gleich
    // identisch, dann ist die fehlende Kaskade ohnehin gegenstandslos.
    logger.warn({
      message: 'Device-Cascade: Vorab-Lookup fehlgeschlagen',
      event: 'device.cascade_capture_failed',
      deviceRecordId: String(context.id),
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }

  return context
}

/**
 * `after.remove`: widerruft und loescht die API-Schluessel des geloeschten Geraets.
 *
 * Ohne diese Kaskade hinterliess jedes geloeschte Geraet einen verwaisten,
 * weiterhin gueltigen Schluessel — `devices.remove` hatte gar keinen Hook,
 * obwohl `after.create` automatisch einen Schluessel anlegt.
 *
 * Aufloesung ueber `apikeys.find({ deviceId })` als Primaerquelle, `apiKeyId` nur
 * als Ergaenzung: `apiKeyId` setzt ein best-effort-Hook, dessen Fehler nur
 * geloggt wird (devices.ts) — es kann also fehlen, und ein Geraet kann mehr als
 * einen Schluessel haben.
 *
 * Reihenfolge: Geraet zuerst (der remove ist bereits durch), Schluessel danach.
 * Umgekehrt bliebe bei einem Fehler ein Geraet ohne Credential zurueck — stilles
 * Bricking. Pro Schluessel erst `active: false`, dann `remove`: scheitert der
 * remove, ist der Schluessel wenigstens entwertet. Keine Transaktion — das
 * Muster hier ist "best effort + Wide Event"; ein Rest wird im Admin als
 * verwaister Schluessel sichtbar und ist dort loeschbar.
 *
 * `params.user` wird durchgereicht, damit `recordAuditEvent` greift:
 * AUDIT_RESOURCE_MAP kennt `apikeys.remove` als API_KEY_REVOKE, der Hook steigt
 * aber ohne Actor aus.
 */
export const cascadeRemoveDeviceApikeys = async (context: HookContext): Promise<HookContext> => {
  const captured = (context.params as CascadeParams).cascadeDevice
  if (!captured?.deviceId && !captured?.apiKeyId) return context

  const actor = context.params.user
  const ids = new Set<string>()

  if (captured.deviceId) {
    try {
      const found = await context.app.service('apikeys').find({
        query: { deviceId: captured.deviceId, $limit: MAX_CASCADE_KEYS },
        provider: undefined,
      } as never)
      const items = Array.isArray(found) ? found : ((found as { data?: Array<{ _id: string }> })?.data ?? [])
      for (const key of items as Array<{ _id: string }>) ids.add(key._id)
    } catch (err) {
      logger.warn({
        message: 'Device-Cascade: apikeys-Lookup fehlgeschlagen',
        event: 'device.cascade_lookup_failed',
        deviceId: captured.deviceId,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (captured.apiKeyId) ids.add(captured.apiKeyId)

  let revokedCount = 0
  let failedCount = 0

  for (const apiKeyId of ids) {
    try {
      await context.app
        .service('apikeys')
        .patch(apiKeyId, { active: false } as never, { provider: undefined, user: actor } as never)
      await context.app.service('apikeys').remove(apiKeyId, { provider: undefined, user: actor } as never)
      revokedCount++
    } catch (err) {
      failedCount++
      logger.error({
        message: 'Device-Cascade: API-Schluessel konnte nicht entfernt werden',
        event: 'device.cascade_apikeys_failed',
        deviceId: captured.deviceId,
        apiKeyId,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info({
    message: 'Geraet entfernt — zugehoerige API-Schluessel widerrufen',
    event: 'device.cascade_apikeys',
    deviceId: captured.deviceId,
    revokedCount,
    failedCount,
  })

  return context
}
