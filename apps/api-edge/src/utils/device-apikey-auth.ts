import { randomUUID } from 'node:crypto'

import {
  ApikeyLifecycleState,
  type ApikeyLifecycleStateValue,
  evaluateApikeyLifecycle,
  isPendingApikeyStale,
  nextApikeyValidUntil,
} from '@panary/apikeys/domain'
import { logger } from '@panary/shared-backend'

import type { Application } from '../declarations'
import { sha256, timingSafeCompare } from './crypto.utils'

/**
 * Transportneutrale Authentifizierung eines Geraete-API-Keys — eine einzige
 * rotations-bewusste Quelle der Wahrheit fuer beide Pruefstellen:
 *   1. WS-Handshake (`channels.ts`) — einmal pro Socket-Verbindung
 *   2. Print-Server-Middleware (`print-server/auth.middleware.ts`) — pro Request
 *
 * Vorher pruefte jede Stelle fuer sich nur `entry.active`. Waere die Rotation
 * nur im Handshake implementiert worden, haette der Print-Pfad den rotierten
 * Schluessel nicht gekannt und mitten in der Schicht 401 geliefert — die Kasse
 * laeuft, die Bons brechen ab.
 *
 * Grundsatz (ADR 0042): `validUntil` weist NIE ab, solange die Karenz laeuft.
 * Hartes Nein gibt es nur bei `active: false` und jenseits der Karenz.
 */

/**
 * Mindestabstand zwischen zwei Rotations-Ausstellungen desselben Schluessels.
 *
 * Deckt zwei Rennen in einem Mechanismus ab (JS ist single-threaded, der
 * Marker wird VOR dem `await` gesetzt):
 *  - zwei gleichzeitige Handshakes desselben Geraets,
 *  - ein Handshake, dessen `find` noch vor dem Persist des ersten lief und der
 *    deshalb `pendingApikey` faelschlich leer sieht.
 *
 * Ohne den Deckel stellten beide je einen Schluessel aus; der Client speicherte
 * den einen, die Datenbank hielte den anderen — genau die Aussperrung, gegen
 * die die ganze pending-Mechanik gebaut ist.
 */
const MINT_GUARD_MS = 60 * 1000

/**
 * Mindestabstand zwischen zwei Karenz-Wide-Events je Schluessel und Transport.
 *
 * 5 Minuten aus demselben Grund wie bei `stampApiKeyLastUsed`: Der Print-Pfad
 * authentifiziert pro HTTP-Request. Ungedrosselt waere das Karenz-Log ein
 * Amplifikator, der genau die Meldung unlesbar macht, wegen der es existiert.
 * Der Transport ist Teil des Schluessels, damit der seltene Handshake nicht
 * hinter einem Schwall Druckauftraege verschwindet.
 */
const GRACE_LOG_INTERVAL_MS = 5 * 60 * 1000

const mintGuard = new Map<string, number>()
const graceLoggedAt = new Map<string, number>()

/** Nur fuer Tests — prozess-lokale Drossel-Zustaende zuruecksetzen. */
export const __resetDeviceApiKeyAuthState = (): void => {
  mintGuard.clear()
  graceLoggedAt.clear()
}

export type DeviceApiKeyTransport = 'websocket' | 'http'

export interface DeviceApiKeyRecord {
  _id: string
  deviceId: string
  tenantId: string
  locationId: string
  role: string
  active: boolean
  validUntil?: string | null
  /**
   * Letzter Kontakt dieses Schluessels — Grundlage der Re-Verifikations-Schwelle
   * (panary/panary-core#325). Der Wert stammt aus `loadCandidates` und ist damit
   * der Stand VOR `stampApiKeyLastUsed`; Rotation und Promotion fassen ihn nicht
   * an, die Messung bleibt also auch bei gleichzeitiger Rotation gueltig.
   */
  lastUsedAt?: string | null
  apikey: string
  pendingApikey?: string | null
  pendingApikeyCreatedAt?: string | null
}

export type DeviceApiKeyAuthResult =
  | {
      ok: true
      record: DeviceApiKeyRecord
      state: ApikeyLifecycleStateValue
      /**
       * Klartext des frisch ausgestellten Schluessels — NUR gesetzt, wenn er
       * bereits persistiert ist. Der Aufrufer stellt ihn dem Client zu; der
       * alte Schluessel bleibt bis zu dessen erstem Gebrauch gueltig.
       */
      rotatedKey?: string
      rotatedValidUntil?: string
    }
  | { ok: false; reason: 'unknown' | 'inactive' | 'expired' }

interface AuthenticateOptions {
  rawKey: string
  deviceId: string
  transport: DeviceApiKeyTransport
  /**
   * Kann dieser Aufrufer einen neuen Schluessel ZUSTELLEN?
   *
   * Nur der WS-Handshake kann das (Socket-Event `device:key-rotated`, der
   * Client schreibt ihn in seine DeviceConfig). Der Print-Pfad hat keinen
   * Kanal, auf dem der Client zuhoert — dort einen Schluessel auszustellen
   * hiesse, einen zu erzeugen, den niemand je abholt. Karenz, pending-Annahme
   * und Promotion greifen dort trotzdem vollstaendig; nur das Ausstellen nicht.
   */
  canIssue: boolean
}

const loadCandidates = async (app: Application, deviceId: string): Promise<DeviceApiKeyRecord[]> => {
  // Lookup ueber `deviceId` statt wie frueher ueber `apikeyPrefix`: Der rotierte
  // Schluessel hat einen anderen Prefix als der gespeicherte, ein Prefix-Lookup
  // faende ihn nicht. `deviceId` ist genauso selektiv (ein Geraet hat im
  // Regelfall genau einen Schluessel) und seit Migration
  // 20260917140000 indiziert.
  const result: unknown = await app.service('apikeys').find({
    query: { deviceId, $limit: 5 },
    provider: undefined,
    paginate: false,
  } as never)

  if (Array.isArray(result)) return result as DeviceApiKeyRecord[]
  return ((result as { data?: DeviceApiKeyRecord[] })?.data ?? []) as DeviceApiKeyRecord[]
}

/**
 * Promotet den pending-Schluessel auf den aktiven und setzt die Uhr neu.
 *
 * Erst hier wird `validUntil` verlaengert — bewusst NICHT beim Ausstellen: Ein
 * Schluessel, der nie abgeholt wird, bekaeme sonst unbegrenzt Verlaengerungen
 * und rotierte in Wahrheit nie. So laeuft der alte Schluessel ab, die Karenz
 * traegt den Betrieb, und jeder Handshake versucht die Rotation erneut.
 */
const promotePendingKey = async (app: Application, record: DeviceApiKeyRecord, now: number): Promise<string> => {
  const validUntil = nextApikeyValidUntil(now)
  await app.service('apikeys').patch(
    record._id,
    {
      apikey: record.pendingApikey,
      apikeyPrefix: (record as { pendingApikeyPrefix?: string | null }).pendingApikeyPrefix,
      pendingApikey: null,
      pendingApikeyPrefix: null,
      pendingApikeyCreatedAt: null,
      validUntil,
    } as never,
    { provider: undefined, _apikeyRotation: true } as never,
  )
  return validUntil
}

/**
 * Stellt einen neuen Schluessel aus und parkt ihn als `pendingApikey`.
 *
 * Fail-safe nach dem Vorbild der Edge↔Cloud-Token-Rotation
 * (panary-cloud `services/sync/sync.ts`): Der Klartext wird NUR zurueckgegeben,
 * wenn der Persist geglueckt ist. Schlaegt er fehl, bleibt der alte Schluessel
 * unveraendert gueltig und der naechste Handshake versucht es erneut.
 */
const issuePendingKey = async (app: Application, record: DeviceApiKeyRecord, now: number): Promise<string | null> => {
  const guardedAt = mintGuard.get(record._id)
  if (guardedAt !== undefined && now - guardedAt < MINT_GUARD_MS) return null

  const pendingIsUsable = Boolean(record.pendingApikey) && !isPendingApikeyStale(record.pendingApikeyCreatedAt, now)
  if (pendingIsUsable) {
    // Ein noch frischer pending-Schluessel wurde bereits zugestellt. Sein
    // Klartext liegt serverseitig nirgends — erneut zustellen ist unmoeglich,
    // ein zweiter Schluessel wuerde den ersten entwerten. Also nichts tun: Der
    // aktive Schluessel gilt weiter, und ist der pending-Schluessel nach
    // APIKEY_PENDING_STALE_DAYS nicht eingeloest, stellt der naechste
    // Handshake einen frischen aus.
    return null
  }

  // Vor dem `await` setzen — siehe MINT_GUARD_MS.
  mintGuard.set(record._id, now)

  const rawKey = randomUUID()
  try {
    await app.service('apikeys').patch(
      record._id,
      {
        pendingApikey: sha256(rawKey),
        pendingApikeyPrefix: rawKey.slice(0, 8),
        pendingApikeyCreatedAt: new Date(now).toISOString(),
      } as never,
      { provider: undefined, _apikeyRotation: true } as never,
    )
    return rawKey
  } catch (err) {
    // Rollback, sonst blockiert der Fehlversuch die naechste Rotation.
    mintGuard.delete(record._id)
    logger.error({
      message: 'Schluessel-Rotation: pendingApikey-Persist fehlgeschlagen — Rotation ausgesetzt',
      event: 'device.key_rotation_persist_failed',
      apiKeyId: record._id,
      deviceId: record.deviceId,
      error: String(err),
    })
    return null
  }
}

/** Stempelt einmalig `validUntil` auf einen Bestands-Key, der nie eines hatte. */
const stampInitialValidUntil = async (app: Application, record: DeviceApiKeyRecord, now: number): Promise<void> => {
  const validUntil = nextApikeyValidUntil(now)
  try {
    await app
      .service('apikeys')
      .patch(record._id, { validUntil } as never, { provider: undefined, _apikeyRotation: true } as never)
    record.validUntil = validUntil
    logger.info({
      message: 'Bestands-Schluessel erstmals befristet',
      event: 'device.key_valid_until_stamped',
      apiKeyId: record._id,
      deviceId: record.deviceId,
      validUntil,
    })
  } catch (err) {
    // Nicht eskalieren: Der Schluessel bleibt unbefristet gueltig, der naechste
    // Kontakt stempelt erneut. Ein fehlgeschlagener Stempel darf einen
    // funktionierenden Handshake nie kippen.
    logger.warn({
      message: 'Bestands-Schluessel konnte nicht befristet werden',
      event: 'device.key_valid_until_stamp_failed',
      apiKeyId: record._id,
      deviceId: record.deviceId,
      error: String(err),
    })
  }
}

const logGrace = (record: DeviceApiKeyRecord, transport: DeviceApiKeyTransport, now: number): void => {
  const key = `${record._id}:${transport}`
  const previous = graceLoggedAt.get(key)
  if (previous !== undefined && now - previous < GRACE_LOG_INTERVAL_MS) return
  graceLoggedAt.set(key, now)

  logger.warn({
    message: 'Geraete-Schluessel abgelaufen — Karenz greift, Rotation wird erzwungen',
    event: 'device.auth',
    status: 'grace',
    deviceId: record.deviceId,
    tenantId: record.tenantId,
    apiKeyId: record._id,
    validUntil: record.validUntil,
    transport,
  })
}

/**
 * Prueft einen Klartext-Schluessel gegen die `apikeys` des Geraets und wickelt
 * Stempel, Promotion und Rotation ab.
 *
 * Wirft nur bei echten Infrastrukturfehlern (DB nicht erreichbar, ungueltige
 * Query) — die Aufrufer behandeln das als Auth-Fehler, nicht als Ablehnung.
 */
export const authenticateDeviceApiKey = async (
  app: Application,
  { rawKey, deviceId, transport, canIssue }: AuthenticateOptions,
): Promise<DeviceApiKeyAuthResult> => {
  const inputHash = sha256(rawKey)
  const now = Date.now()

  const candidates = await loadCandidates(app, deviceId)

  let matched: DeviceApiKeyRecord | undefined
  let matchedPending = false
  for (const entry of candidates) {
    if (typeof entry.apikey === 'string' && timingSafeCompare(inputHash, entry.apikey)) {
      matched = entry
      break
    }
    if (typeof entry.pendingApikey === 'string' && timingSafeCompare(inputHash, entry.pendingApikey)) {
      matched = entry
      matchedPending = true
      break
    }
  }

  if (!matched) return { ok: false, reason: 'unknown' }

  // Ausdrueckliche Sperre schlaegt jede Lebenszyklus-Bewertung — und zwar auch
  // dann, wenn der Schluessel gerade rotiert wird.
  if (!matched.active) return { ok: false, reason: 'inactive' }

  if (matchedPending) {
    // Der Client hat den neuen Schluessel angenommen: Rotation abgeschlossen.
    try {
      const validUntil = await promotePendingKey(app, matched, now)
      matched.validUntil = validUntil
      matched.pendingApikey = null
      logger.info({
        message: 'Geraete-Schluessel rotiert — neuer Schluessel uebernommen',
        event: 'device.key_rotated',
        status: 'promoted',
        deviceId: matched.deviceId,
        tenantId: matched.tenantId,
        apiKeyId: matched._id,
        validUntil,
        transport,
      })
    } catch (err) {
      // Der Schluessel ist verifiziert — die Verbindung darf nicht an einem
      // fehlgeschlagenen Buchhaltungs-Schritt scheitern. `pendingApikey` bleibt
      // stehen und wird beim naechsten Kontakt erneut promotet.
      logger.error({
        message: 'Schluessel-Rotation: Promotion fehlgeschlagen — Verbindung trotzdem zugelassen',
        event: 'device.key_rotation_promote_failed',
        apiKeyId: matched._id,
        deviceId: matched.deviceId,
        error: String(err),
      })
    }
    return { ok: true, record: matched, state: ApikeyLifecycleState.VALID }
  }

  const lifecycle = evaluateApikeyLifecycle(matched.validUntil, now)

  if (lifecycle.state === ApikeyLifecycleState.UNSTAMPED) {
    // Bestands-Schluessel: Die Uhr startet beim ersten Kontakt DIESES Geraets,
    // nicht flottenweit am Deploy-Tag (siehe Migration).
    await stampInitialValidUntil(app, matched, now)
    return { ok: true, record: matched, state: ApikeyLifecycleState.UNSTAMPED }
  }

  if (!lifecycle.accepted) return { ok: false, reason: 'expired' }

  if (lifecycle.state === ApikeyLifecycleState.GRACE) logGrace(matched, transport, now)

  if (lifecycle.rotationDue && canIssue) {
    const rotatedKey = await issuePendingKey(app, matched, now)
    if (rotatedKey) {
      return {
        ok: true,
        record: matched,
        state: lifecycle.state,
        rotatedKey,
        // Das Ablaufdatum gilt erst nach der Promotion. Der Client bekommt es
        // nur zur Anzeige/Diagnose — autoritativ ist der Server.
        rotatedValidUntil: nextApikeyValidUntil(now),
      }
    }
  }

  return { ok: true, record: matched, state: lifecycle.state }
}
