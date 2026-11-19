// Boot-Lauf fuer den `cloudToken` at-rest (panary/panary-core#1498, ADR 0109 in panary/panary-cloud).
//
// Was der Lauf tut, je Zeile der Tabelle `cloud-connection`:
//
//   - Klartext-Token + Schluessel gesetzt  → verschluesseln und zurueckschreiben.
//   - Verschluesselter Token + Schluessel  → Probe-Entschluesselung. Scheitert sie, ist der Schluessel
//     falsch (oder der Token beschaedigt): laute Meldung, KEIN Klartext-Fallback, nichts wird veraendert.
//   - Klartext-Token ohne Schluessel       → bleibt Klartext, die Meldung nennt den Behebungsweg.
//   - Verschluesselter Token ohne Schluessel → Fehlermeldung: Der Edge kann sich nicht mehr bei der Cloud
//     melden, bis der urspruengliche Schluessel wieder gesetzt ist.
//
// Bewusst eine MELDUNG und kein Boot-Abbruch: Das Erzwingen ist Teil B (panary/panary-core#1499). Ein Edge,
// der per Watchtower ein neues Image bekommt, aber nie einen Installer-Lauf hatte, hat keinen Schluessel —
// ein Abbruch waere dort ein Kassenausfall.
//
// Laeuft VOR dem Sync-Scheduler (main.ts): Sonst koennte die Token-Rotation des Heartbeats zwischen Lesen und
// Zurueckschreiben einen frischen Token mit dem alten ueberschreiben.
//
// Schluessel und Token werden nie geloggt.
import { logger } from '@panary/shared-backend'

import {
  TOKEN_KEY_MIN_LENGTH,
  TOKEN_KEY_RECOMMENDED_LENGTH,
  decryptCloudToken,
  encryptCloudToken,
  getTokenKeyStatus,
  isEncryptedToken,
} from './cloud-token-cipher'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Feathers Application hat generischen Typ Application<any, any>
type FeathersApp = any

const KEY_HINT =
  'Behebung: Installer erneut ausfuehren (`curl -fsSL https://get.panary.cloud | sudo bash`) — er erzeugt ' +
  'EDGE_TOKEN_ENCRYPTION_KEY, traegt ihn in die .env ein und startet den Container neu. Ein vorhandener ' +
  'Schluessel wird dabei nie ersetzt.'

export interface CloudTokenBootMigrationResult {
  keyStatus: 'missing' | 'weak' | 'ok'
  /** Zeilen mit Token (leere Tokens zaehlen nicht). */
  rows: number
  /** Klartext-Token, die in diesem Lauf verschluesselt wurden. */
  encrypted: number
  /** Klartext-Token, die ohne Schluessel Klartext bleiben. */
  plaintext: number
  /** Verschluesselte Token, die sich mit dem vorhandenen Schluessel nicht lesen lassen. */
  unreadable: number
  /** Verschluesselte Token, die sich lesen lassen — ohne Aenderung. */
  verified: number
  /** Zeilen, bei denen das Zurueckschreiben scheiterte. */
  failed: number
}

/**
 * Wirft nie. Ein Fehler beim Lesen der Tabelle (z. B. beim allerersten Boot) wird gemeldet und beendet den
 * Lauf; der Boot geht weiter.
 */
export const runCloudTokenBootMigration = async (app: FeathersApp): Promise<CloudTokenBootMigrationResult | null> => {
  const { status: keyStatus, length } = getTokenKeyStatus()
  const result: CloudTokenBootMigrationResult = {
    keyStatus,
    rows: 0,
    encrypted: 0,
    plaintext: 0,
    unreadable: 0,
    verified: 0,
    failed: 0,
  }

  if (keyStatus === 'weak') {
    logger.warn({
      message:
        `EDGE_TOKEN_ENCRYPTION_KEY ist kurz (${length} Zeichen, empfohlen ab ${TOKEN_KEY_RECOMMENDED_LENGTH}). ` +
        'Er wird weiter benutzt und nicht ersetzt — ein neuer Schluessel machte den verschluesselten ' +
        'Cloud-Token unlesbar (Re-Pairing noetig).',
      event: 'bootstrap.token_key_weak',
      keyLength: length,
      minLength: TOKEN_KEY_MIN_LENGTH,
    })
  }

  let rows: Array<{ _id: string; cloudToken?: string | null }>
  try {
    const found = await app.service('cloud-connection').find({ provider: undefined, paginate: false })
    rows = (Array.isArray(found) ? found : (found?.data ?? [])) as typeof rows
  } catch (err) {
    logger.warn({
      message: 'cloudToken-Boot-Lauf uebersprungen — cloud-connection nicht lesbar',
      event: 'bootstrap.token_migration_skipped',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return null
  }

  for (const row of rows) {
    const token = row.cloudToken
    if (typeof token !== 'string' || token.length === 0) continue
    result.rows++

    if (isEncryptedToken(token)) {
      try {
        decryptCloudToken(token)
        result.verified++
      } catch (err) {
        result.unreadable++
        logger.error({
          message:
            keyStatus === 'missing'
              ? 'cloudToken ist verschluesselt gespeichert, aber EDGE_TOKEN_ENCRYPTION_KEY fehlt — der Edge ' +
                'erreicht die Cloud nicht. Den urspruenglichen Schluessel wieder in die .env eintragen ' +
                '(ein neuer Schluessel hilft nicht, dann ist ein Re-Pairing noetig).'
              : 'cloudToken ist verschluesselt gespeichert, laesst sich mit EDGE_TOKEN_ENCRYPTION_KEY aber nicht ' +
                'entschluesseln — falscher Schluessel oder beschaedigter Token. Kein Klartext-Fallback; ' +
                'den urspruenglichen Schluessel wieder eintragen, sonst ist ein Re-Pairing noetig.',
          event: 'bootstrap.token_key_mismatch',
          connectionId: row._id,
          keyStatus,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
      continue
    }

    // Klartext
    if (keyStatus === 'missing') {
      result.plaintext++
      continue
    }

    try {
      await app.service('cloud-connection')._patch(row._id, { cloudToken: encryptCloudToken(token) })
      result.encrypted++
    } catch (err) {
      result.failed++
      logger.error({
        message:
          'cloudToken konnte nicht nachverschluesselt werden — er bleibt im Klartext, naechster Boot versucht es erneut',
        event: 'bootstrap.token_encrypt_failed',
        connectionId: row._id,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (result.plaintext > 0) {
    logger.warn({
      message:
        `EDGE_TOKEN_ENCRYPTION_KEY ist nicht gesetzt — ${result.plaintext} cloudToken liegt im Klartext in der ` +
        `Datenbank. Mit einem kuenftigen Release startet der Edge ohne Schluessel nicht mehr. ${KEY_HINT}`,
      event: 'bootstrap.token_key_missing',
      plaintextTokens: result.plaintext,
    })
  } else if (keyStatus === 'missing') {
    logger.warn({
      message:
        'EDGE_TOKEN_ENCRYPTION_KEY ist nicht gesetzt — ein spaeter gekoppelter Cloud-Token wuerde im Klartext ' +
        `gespeichert. Mit einem kuenftigen Release startet der Edge ohne Schluessel nicht mehr. ${KEY_HINT}`,
      event: 'bootstrap.token_key_missing',
      plaintextTokens: 0,
    })
  }

  if (result.encrypted > 0) {
    logger.info({
      message: `cloudToken beim Boot nachverschluesselt (${result.encrypted})`,
      event: 'bootstrap.token_encrypted',
      encrypted: result.encrypted,
    })
  }

  return result
}
