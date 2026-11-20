import { logger } from '@panary/shared-backend'
import type { SyncHeartbeatRequest } from '@panary/sync/domain'

import { getTokenKeyStatus } from '../utils/cloud-token-cipher'

/**
 * Zustand des `EDGE_TOKEN_ENCRYPTION_KEY` fuer den Cloud-Heartbeat (core#1508).
 *
 * Meldet ausschliesslich `missing | weak | ok` — weder der Schluessel noch seine Laenge noch ein Hash
 * verlassen die Edge. Die Cloud zaehlt damit, wie viele Edges noch ohne Schluessel laufen; das ist die
 * Messung, die core#1499 (Boot-Guard) vor dem Erzwingen verlangt.
 *
 * ⚠️ FAILURE-ISOLATION IST PFLICHT: Ein Fehler im Heartbeat zaehlt zu den drei Fehlversuchen bis zum
 * Notfall-Modus der gesamten Edge. Der Helper wirft deshalb nie und liefert im Zweifel `{}`.
 *
 * Der Rueckgabetyp ist an das Schema gebunden, damit Feldname und Literale typgeprueft sind — der
 * Heartbeat-Body selbst ist ein untypisiertes Literal.
 */
export const buildTokenKeyHeartbeatBlock = (): Pick<SyncHeartbeatRequest, 'tokenKey'> => {
  try {
    return { tokenKey: getTokenKeyStatus().status }
  } catch (err) {
    logger.warn({
      message: 'Token-Schluessel-Zustand fuer Heartbeat nicht ermittelbar — Heartbeat laeuft ohne',
      event: 'sync.heartbeat.token_key_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return {}
  }
}
