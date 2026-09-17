// Durchsetzung der Re-Verifikation nach langer Offline-Phase
// (panary/panary-core#325).
//
// Der Bestaetigungsbildschirm am Terminal ist Bedienerfuehrung, keine
// Sicherheitsgrenze: Wer den Geraete-Schluessel hat, spricht direkt mit dem
// Socket und sieht kein Angular. Die Grenze sitzt deshalb hier, als
// App-Level-Hook hinter `allowApiKey`.
import { Unavailable } from '@feathersjs/errors'

import { DEVICE_REVERIFICATION_ERROR_CODE } from '@panary/devices/domain'
import { logger } from '@panary/shared-backend'

import type { HookContext, NextFunction } from '../declarations'
import type { DeviceReverificationConnectionState } from '../utils/device-reverification'

/**
 * Was ein Terminal mit ausstehender Bestaetigung noch darf — eine ALLOWLIST,
 * kein Verbotskatalog.
 *
 * Fail-closed ist hier die einzig haltbare Richtung: Eine Liste gesperrter
 * Pfade muesste bei jeder neuen Custom-Method nachgezogen werden, und die
 * vergessene Zeile faellt erst auf, wenn jemand sie ausnutzt. So ist eine neue
 * Methode automatisch gesperrt, bis jemand sie bewusst oeffnet.
 *
 * - `find`/`get`: Lesen bleibt erlaubt, sonst zeigt das Terminal einen leeren
 *   Bildschirm und der Bediener kann nicht einmal die Person auswaehlen, die
 *   freigeben soll.
 * - `verifyPin`: DER Freigabe-Pfad selbst (`users.verifyPin`, siehe
 *   `services/users/users.ts`). Ohne ihn waere der Zustand nicht aufloesbar.
 *   Der PIN-Brute-Force-Schutz greift dort unveraendert.
 */
const ALLOWED_METHODS = new Set<string>(['find', 'get', 'verifyPin'])

/**
 * 🚨 Der Fehler MUSS als `transient` durchgehen.
 *
 * `classifyOutboxError` (`libs/shared/offline-cache/src/lib/outbox.ts`) stuft
 * 400/401/403/422 als `terminal` ein und verwirft den Outbox-Eintrag. Eine
 * offline erfasste Bestellung waere damit unwiederbringlich weg — nur weil das
 * Terminal eine Bestaetigung schuldet, die Sekunden spaeter erteilt wird.
 * `Unavailable` (503) faellt in den `transient`-Zweig: Die Bestellung bleibt in
 * der Outbox und laeuft nach der Freigabe durch.
 */
const rejection = (): Unavailable =>
  new Unavailable('Dieses Geraet muss erst bestaetigt werden.', { code: DEVICE_REVERIFICATION_ERROR_CODE })

/**
 * Around-Hook (App-Level, direkt nach `allowApiKey`): sperrt alles ausser
 * Lesen und dem Freigabe-Pfad, solange die Connection eine Bestaetigung
 * schuldet.
 *
 * Wirkt ausschliesslich auf externe Geraete-Verbindungen. Interne Aufrufe
 * (`provider: undefined` — Sync-Apply, Worker, Bootstrap) und JWT-Sessions im
 * Admin sind nicht betroffen: Das Merkmal haengt an der Socket-Connection, die
 * der Geraete-Handshake gestempelt hat.
 */
export const requireDeviceReverification = () => {
  return async (context: HookContext, next: NextFunction) => {
    const conn = context.params.connection as (DeviceReverificationConnectionState & { deviceId?: string }) | undefined

    if (context.params.provider && conn?.requiresReverification === true && !ALLOWED_METHODS.has(context.method)) {
      logger.warn({
        message: 'Zugriff abgelehnt — Geraet wartet auf Bestaetigung nach langer Offline-Phase',
        event: 'device.reverification_blocked',
        deviceId: conn.deviceId,
        service: context.path,
        method: context.method,
        offlineSince: conn.reverificationOfflineSince,
      })
      throw rejection()
    }

    await next()
  }
}
