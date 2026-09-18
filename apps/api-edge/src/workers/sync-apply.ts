// Geteiltes Sync-Apply-Modul fuer die Cloud→Edge-Pull-Pfade.
//
// Vor der Extraktion existierte die komplette Apply-Logik DOPPELT
// (cloud-sync-scheduler.worker.ts + cloud-bootstrap-runner.worker.ts) — inkl.
// eigenem `cloudFetch` und mehrfach kopierter AJV-Fehler-Extraktion. Dieses
// Modul ist die Single Source fuer:
//
//  - `cloudFetch`               — EIN authentifizierter Cloud-HTTP-Call
//  - `extractAjvValidationErrors` — EINE AJV-Fehler-Extraktion (Feathers
//    `BadRequest` packt das AJV-Array unter `.data`, alte Builds: `.errors`)
//  - `pullMasterDataPage`       — eine Seite `/sync-pull` holen
//  - `applyPulledRecords`       — gepullte Records via Service-API anwenden
//
// Performance-Kern von `applyPulledRecords`: der Existenz-Check laeuft
// GEBATCHT — EIN `find({ _id: { $in: pageIds }, $select: ['_id'] })` pro
// Pull-Seite statt einem `get().catch(() => null)` pro Record. Bei einer
// vollen 500er-Seite spart das 499 Feathers-Roundtrips (inkl. Hook-Chains).
import { logger } from '@panary/shared-backend'
import {
  rateLimitDelayMs,
  SyncOp,
  type SyncPullResponse,
  type SyncRunRecordDetail,
  SyncRunRecordStatus,
} from '@panary/sync/domain'
import { stripUserEdgeLocalFields } from '@panary/users/domain'

import { findReportableCloudConnection } from '../utils/cloud-connection-lookup'

import type { Application } from '../declarations'

/** Seitengroesse fuer `/sync-pull` — muss <= SYNC_PULL_MAX_LIMIT der Cloud sein. */
export const PULL_PAGE_SIZE = 500

/** Default-Timeout fuer Cloud-Calls ohne expliziten `timeoutMs` (Heartbeat-Klasse). */
export const DEFAULT_CLOUD_FETCH_TIMEOUT_MS = 10_000

/** Default-Timeout fuer `/sync-pull`-Seiten (grosse Pages brauchen laenger als Heartbeats). */
export const PULL_TIMEOUT_MS = 30_000

export const cloudFetch = async (
  cloudUrl: string,
  cloudToken: string,
  pathSuffix: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> => {
  const { timeoutMs = DEFAULT_CLOUD_FETCH_TIMEOUT_MS, ...rest } = init
  return fetch(`${cloudUrl}${pathSuffix}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      // Custom-Header statt Authorization: Bearer — vermeidet Konflikt mit der
      // Cloud-JWT-Strategy, die jeden Bearer-Token zuerst parsed.
      'X-Edge-Token': cloudToken,
      ...(rest.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/**
 * Marker-Error fuer ein Rueckstau-Signal der Cloud (HTTP 429).
 *
 * Er trennt „die Cloud hat mich gedrosselt" von „der Call ist gescheitert" —
 * eine Unterscheidung, die es vorher nicht gab und deren Fehlen den teuersten
 * Weg nahm: `runHeartbeatPhase` zaehlte den 429 als Fehlversuch, und drei davon
 * aktivieren den Notfall-Modus der GESAMTEN Edge. Ein Rate-Limit der Cloud
 * konnte damit den Kunden lahmlegen, den es schuetzen soll.
 *
 * `retryAfterMs` ist bereits ausgewertet und geklemmt (siehe
 * `rateLimitDelayMs`); Aufrufer rechnen nicht selbst am Header.
 * Entscheidung: `docs/adr/0019-edge-429-rueckstau-behandlung.md`.
 */
export class CloudRateLimitedError extends Error {
  override readonly name = 'CloudRateLimitedError'
  constructor(
    public readonly phase: string,
    public readonly retryAfterMs: number,
    public readonly retryAfterHeader: string | null,
  ) {
    super(`Cloud-Rate-Limit (429) in Phase ${phase} — naechster Versuch in ${Math.round(retryAfterMs / 1000)}s`)
  }
}

/**
 * Wirft `CloudRateLimitedError`, wenn die Cloud mit 429 geantwortet hat — sonst
 * no-op. An JEDER Cloud-Call-Site VOR der bestehenden `!response.ok`-Behandlung
 * aufrufen; alle anderen Statuscodes bleiben dadurch unveraendert.
 *
 * Die eine Logzeile entsteht hier, an der Quelle: `sync.rate_limited` traegt
 * Phase, Roh-Header und ausgewertete Wartezeit. Aufrufer duerfen den 429 NICHT
 * erneut loggen (die Phasen-Wrapper unterdruecken ihre generischen
 * `*.worker_exception`-Warns fuer diesen Error-Typ) — sonst steht derselbe
 * Vorgang bis zu dreimal im Terminal.
 */
export const throwIfRateLimited = (response: Response, phase: string, nowMs: number = Date.now()): void => {
  if (response.status !== 429) return
  const header = response.headers.get('retry-after')
  const retryAfterMs = rateLimitDelayMs(header, nowMs)
  logger.warn({
    message: `Cloud drosselt (429) in Phase ${phase} — Wiederholung in ${Math.round(retryAfterMs / 1000)}s`,
    event: 'sync.rate_limited',
    phase,
    status: 429,
    retryAfterHeader: header,
    retryAfterMs,
  })
  throw new CloudRateLimitedError(phase, retryAfterMs, header)
}

export interface AjvValidationErrorDetail {
  path: string
  message: string
  keyword?: string
  params?: unknown
}

/**
 * Extrahiert AJV-Validierungsfehler aus einem Feathers-`BadRequest`-Error.
 *
 * Feathers packt das AJV-Array unter `.data` (alte Builds: `.errors`). Ohne
 * diese Extraktion loggt der Edge nur das nichtssagende "validation failed" —
 * mit ihr sieht der Operator SOFORT, welches Feld an welchem Service haengt.
 */
export const extractAjvValidationErrors = (err: unknown): AjvValidationErrorDetail[] | undefined => {
  const errAny = err as {
    data?: Array<Record<string, unknown>>
    errors?: Array<Record<string, unknown>>
  }
  const arr = Array.isArray(errAny?.data) ? errAny.data : Array.isArray(errAny?.errors) ? errAny.errors : undefined
  if (!arr || arr.length === 0) return undefined
  return arr.map(e => ({
    path: (e['instancePath'] as string) || (e['path'] as string) || '<root>',
    message: (e['message'] as string) ?? '?',
    keyword: e['keyword'] as string | undefined,
    params: e['params'],
  }))
}

/** Eine Seite `/sync-pull` von der Cloud holen (cursor-basierte Pagination). */
export const pullMasterDataPage = async (
  cloudUrl: string,
  cloudToken: string,
  service: string,
  since: string | undefined,
  cursor: string | undefined,
  timeoutMs: number = PULL_TIMEOUT_MS,
): Promise<SyncPullResponse> => {
  const params = new URLSearchParams()
  params.set('service', service)
  params.set('limit', String(PULL_PAGE_SIZE))
  if (since) params.set('since', since)
  if (cursor) params.set('cursor', cursor)
  const response = await cloudFetch(cloudUrl, cloudToken, `/sync-pull?${params.toString()}`, {
    method: 'GET',
    timeoutMs,
  })
  throwIfRateLimited(response, `pull:${service}`)
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unbekannter Fehler')
    throw new Error(`Pull fuer ${service} fehlgeschlagen: ${response.status} ${text}`)
  }
  return response.json() as Promise<SyncPullResponse>
}

export interface ApplyPulledRecordsOptions {
  /**
   * - `upsert` (Default): Existenz-Check GEBATCHT pro Seite (EIN `find` mit
   *   `_id: { $in: pageIds }`), danach patch (existiert) bzw. create (neu).
   * - `insert`: direkter create OHNE Existenz-Check. Ausschliesslich fuer den
   *   Bootstrap-Pfad `pull-cloud-to-edge`, der die Master-Tabellen unmittelbar
   *   davor truncated hat — dort ist jede `_id` garantiert neu, der Find waere
   *   pro Seite ein sinnloser Leer-Roundtrip.
   */
  mode?: 'upsert' | 'insert'
  /**
   * Mandant, auf den dieser Edge gepairt ist — Referenz fuer den
   * Fremd-Mandanten-Guard (#337).
   *
   * 🚫 Fehlt der Wert (undefined/null), ist der Guard AUS und kein Record wird
   * beanstandet. Das ist Absicht: Ein Guard, der ohne Referenz anschlaegt, wuerde
   * genau in den Lagen Laerm machen, in denen der Edge legitim noch keinen
   * Mandanten kennt (Erstinstallation, Pairing vor dem Restamp). Fail-open, weil
   * der Guard eine ZWEITE Linie hinter der Cloud-Filterung ist, nicht die erste.
   */
  expectedTenantId?: string | null
  /**
   * `_id` der `cloud-connection`-Zeile, auf der die Fremd-Mandanten-Raste landen soll.
   *
   * Muss durchgereicht werden, weil die Tabelle mehr als eine Zeile enthalten kann —
   * Altlasten aus abgebrochenen Pairings werden nirgends aufgeraeumt, und es gibt
   * keinen Unique-Constraint (`utils/cloud-connection-lookup.ts`). Ein blindes
   * `find({ $limit: 1 })` traefe eine beliebige davon; landete die Raste auf einer
   * Altlast-Zeile, waere der Befund fuer den Heartbeat unsichtbar — der liest aus der
   * aktiven Verbindung. Der Melder waere still wirkungslos, also genau das, was dieser
   * Guard verhindern soll.
   */
  connectionId?: string
}

export interface ApplyPulledRecordsResult {
  /** Erfolgreich angewandte Records (create + patch + remove). */
  applied: number
  /** Records, deren Apply fehlgeschlagen ist (z.B. Edge-Validator). */
  rejected: number
  /** Per-Record-Details fuer sync-run-Eintraege (ungekappt — Caller kappt). */
  details: SyncRunRecordDetail[]
  /**
   * Records dieser Seite mit fremder `tenantId` (#337). Sie wurden TROTZDEM
   * angewandt und zaehlen deshalb auch in `applied` — der Wert ist ein Befund,
   * keine Fehlerzahl.
   */
  foreignTenant: number
}

/**
 * Wendet eine Seite gepullter Cloud-Records auf die Edge-DB an — via
 * Feathers-Service-API mit `{ provider: undefined, fromSync: true }`.
 *
 * `fromSync: true` signalisiert den Resolvern (z.B. userPatchResolver), den
 * eingehenden Wert UNVERAENDERT zu uebernehmen — kein Re-Hash auf bereits
 * gehashten posPin/password, kein Re-Generate auf createdAt/employeeNumber.
 * Sonst Doppelt-Hashing → Login-Bruch.
 *
 * Geraetelokale Time-Clock-Felder (stampingId/startBreakAt) werden bei `users`
 * NICHT aus dem Cloud-Record uebernommen — sie sind reiner Edge-Runtime-
 * Zustand (Kommen/Gehen/Pause am POS). Der Pull-Apply ist bedingungslos (kein
 * Last-Write-Wins); ohne dieses Strip wuerde ein lokaler Pause-/Stempel-Clear
 * vom naechsten Pull rueckgaengig gemacht → Deadlock. Siehe
 * USER_EDGE_LOCAL_FIELDS in @panary/users/domain.
 *
 * Fehler pro Record werden geloggt + als REJECTED-Detail zurueckgegeben —
 * ein kaputter Record blockiert nie den Rest der Seite. Idempotent: dieselbe
 * Seite doppelt angewandt (upsert) ergibt beim zweiten Lauf nur Patches.
 */
/**
 * Entfernt das mit ADR 0030 abgeschaffte Legacy-Rabattfeld `order.discount` aus einem
 * eingehenden Sync-Record — dieselbe Klasse wie der `_deletedAt`-Strip unten (#308/#310).
 *
 * Bestands-Orders aus der Zeit vor ADR 0030 tragen das Feld weiter; `orderDataSchema`
 * und `orderPatchSchema` sind `additionalProperties: false` und kennen es nicht. Ohne
 * Strip lehnt `validateData` den Record ab — und weil `upsertCursor` im Scheduler
 * unabhaengig vom Ergebnis vorrueckt, liefert der naechste Pull nur noch Neueres: Die
 * Bestellung kaeme NIE wieder an. Ein stiller Totalverlust, kein verzoegerter Retry.
 *
 * 🚫 Bewusst NUR fuer `orders`. `discountSchema` (Stammdaten-Konditionen an Kunde,
 * Firmenkunde, User, Filiale) fuehrt ein gleichnamiges Feld voellig legitim — ein
 * pauschaler Strip ueber alle Services wuerde Stammdaten beschaedigen.
 *
 * Die Log-Zeile ist Teil des Zwecks: Sie beantwortet, ob es solche Bestands-Orders
 * ueberhaupt gibt. Taucht `sync.pull.legacy_discount_stripped` nie auf, gibt es den Fall
 * nicht — das ersetzt eine einmalige Prod-Zaehlung und deckt zusaetzlich Edges ab, die
 * erst spaeter wieder online kommen, sowie Restores aus Backups.
 */
const stripLegacyOrderDiscount = (
  service: string,
  record: Record<string, unknown>,
  entityId: string,
): Record<string, unknown> => {
  if (service !== 'orders' || !('discount' in record)) return record
  const { discount: _legacyDiscount, ...rest } = record
  logger.warn({
    message: 'Pull-Apply: abgeschafftes Legacy-Feld `discount` aus Bestands-Order entfernt',
    event: 'sync.pull.legacy_discount_stripped',
    service,
    entityId,
  })
  return rest
}

/**
 * Prueft, ob ein eingehender Cloud-Record zu einem FREMDEN Mandanten gehoert (#337).
 *
 * Liefert die fremde `tenantId` oder `null`. Drei Faelle geben bewusst `null`:
 *
 *  1. **Kein erwarteter Mandant** — siehe `expectedTenantId` in den Options: ohne
 *     Referenz gibt es keinen Befund, nur Rauschen.
 *  2. **Record ohne `tenantId`** — nicht jeder gesyncte Service fuehrt das Feld.
 *     `tenants` traegt seine Identitaet in `_id`; cloud-seitig ist das dieselbe
 *     Fallunterscheidung (`sync-pull-strategies.ts`: Basisfilter `{ _id: user.tenantId }`
 *     statt `{ tenantId: … }`), und die Edge-Replica hat gar keine `tenantId`-Spalte.
 *     Ein Guard, der hier anschlaegt, sperrt harmlose Services aus.
 *  3. **Leerstring** — behandeln wir wie „Feld nicht gefuehrt", nicht wie einen
 *     Mismatch: ein leerer Wert ist ein Datenfehler, kein Mandantenwechsel.
 */
export const detectForeignTenantId = (
  expectedTenantId: string | null | undefined,
  record: Record<string, unknown>,
): string | null => {
  if (typeof expectedTenantId !== 'string' || expectedTenantId.length === 0) return null
  const actual = record['tenantId']
  if (typeof actual !== 'string' || actual.length === 0) return null
  return actual === expectedTenantId ? null : actual
}

/**
 * Stempelt die Fremd-Mandanten-Raste auf `cloud-connection` (#337).
 *
 * Diese Raste ist der einzige Weg, auf dem der Befund je einen Menschen erreicht:
 * Der `api-edge` hat kein externes Fehler-Reporting, `sync-runs` und
 * `bootstrap-reports` bleiben lokal, und das Alarmsystem der Cloud nimmt keine
 * Edge-Schreibzugriffe an. Der Heartbeat liest die Raste und meldet sie weiter.
 *
 * Deshalb PERSISTENT und nicht im RAM: Der Record ist nach dem Apply geschrieben und
 * der Cursor vorgerueckt — er kommt nie wieder. Ginge die Sichtung beim naechsten
 * Neustart verloren, waere sie fuer immer weg (dieselbe Klasse wie der
 * RAM-Breach-State, der die Cloud-AlertEngine schon einmal blind gemacht hat).
 *
 * Vollstaendig fehler-isoliert: Ein Problem beim Stempeln darf den Pull-Apply nie
 * scheitern lassen — sonst wuerde ausgerechnet die Diagnose die Daten kosten, die sie
 * schuetzen soll.
 */
const stampForeignTenantLatch = async (
  app: Application,
  params: { count: number; lastForeignTenantId: string; connectionId?: string },
): Promise<void> => {
  try {
    const service = app.service('cloud-connection' as any) as any
    // `.get()` statt `._get()`: Der Service haengt JSON-Hooks in die Pipeline, die
    // verschachtelte Felder deserialisieren (gleiche Begruendung wie beim
    // `refreshed`-Reload im Bootstrap-Runner).
    //
    // Der Rueckfall auf `findReportableCloudConnection` greift nur, wenn ein Aufrufer
    // keine `connectionId` mitgibt — er waehlt dann nach dokumentierter Regel
    // (CONNECTED bevorzugt) statt blind. Beides bewusst statt eines stillen Abbruchs:
    // Ein Melder, der lieber nichts meldet, als die Zeile zu raten, waere kein Melder.
    const connection = params.connectionId
      ? ((await service.get(params.connectionId, { provider: undefined }).catch(() => null)) as {
          _id: string
          foreignTenantRecordsCount?: number | null
        } | null)
      : ((await findReportableCloudConnection(app)) as unknown as {
          _id: string
          foreignTenantRecordsCount?: number | null
        } | null)
    if (!connection) {
      logger.warn({
        message: 'Pull-Apply: keine cloud-connection-Zeile fuer die Fremd-Mandanten-Raste gefunden',
        event: 'sync.pull.foreign_tenant_latch_failed',
        connectionId: params.connectionId,
      })
      return
    }
    const previous = typeof connection.foreignTenantRecordsCount === 'number' ? connection.foreignTenantRecordsCount : 0
    // `_patch` (Adapter-Ebene) wie JEDER andere Schreibzugriff auf `cloud-connection`
    // aus einem Worker (`persistStatus` im Bootstrap-Runner, die acht Stellen im
    // Sync-Scheduler) — es gibt im `api-edge` keinen einzigen internen `.patch` auf
    // diesen Service. Grund ist der Kontext, nicht Bequemlichkeit: Der Aufruf kommt
    // aus einem Hintergrundprozess ohne `params.user`, und `around.all` beginnt mit
    // `authenticate`/`authorize`.
    await service._patch(connection._id, {
      foreignTenantRecordsAt: new Date().toISOString(),
      foreignTenantRecordsCount: previous + params.count,
      foreignTenantRecordsLastTenantId: params.lastForeignTenantId,
    })
  } catch (err) {
    logger.warn({
      message: 'Pull-Apply: Fremd-Mandanten-Raste konnte nicht gestempelt werden',
      event: 'sync.pull.foreign_tenant_latch_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

export const applyPulledRecords = async (
  app: Application,
  service: string,
  records: SyncPullResponse['records'],
  options: ApplyPulledRecordsOptions = {},
): Promise<ApplyPulledRecordsResult> => {
  const mode = options.mode ?? 'upsert'
  const details: SyncRunRecordDetail[] = []
  let applied = 0
  let rejected = 0
  // Fremd-Mandanten-Guard (#337): pro Seite VERDICHTET, nicht pro Record. Eine
  // gebrochene Cloud-Filterung liefert nicht einen Fremdrecord, sondern eine ganze
  // Seite — eine Logzeile je Record waere dann 500 Zeilen fuer einen Befund, und ein
  // Rasten-Patch je Record 500 Schreibvorgaenge. Dieselbe Lehre wie bei der
  // Alarm-Verdichtung der Cloud (ADR 0058): N Vorfaelle sind eine Meldung, nicht N.
  let foreignTenant = 0
  let lastForeignTenantId: string | null = null
  const foreignSampleIds: string[] = []
  if (records.length === 0) return { applied, rejected, details, foreignTenant }

  // Existenz-Check gebatcht: EIN find pro Pull-Seite statt get pro Record.
  // Ohne User im Params-Kontext bypassed multiTenancy den Filter — die _ids
  // stammen ohnehin aus dem tenant-gescopten Cloud-Pull.
  let existingIds = new Set<string>()
  if (mode === 'upsert') {
    const upsertIds = records.filter(item => !item.deletedAt).map(item => item._id)
    if (upsertIds.length > 0) {
      try {
        const found = (await app.service(service as any).find({
          provider: undefined,
          paginate: false,
          query: { _id: { $in: upsertIds }, $select: ['_id'] },
        } as any)) as Array<{ _id: string }>
        existingIds = new Set((Array.isArray(found) ? found : []).map(row => row._id))
      } catch (err) {
        // Degradieren statt Seite verwerfen: ohne Existenz-Wissen behandeln wir
        // alle Records als neu — existierende laufen dann in den Create-Fehlerpfad
        // und werden dort als REJECTED geloggt (kein Datenverlust, nur Laerm).
        logger.warn({
          message: 'Pull-Apply: gebatchter Existenz-Check fehlgeschlagen — fahre mit create-first fort',
          event: 'sync.pull.batch_exists_failed',
          service,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  for (const item of records) {
    let op: SyncRunRecordDetail['op'] = SyncOp.CREATE
    try {
      if (item.deletedAt) {
        op = SyncOp.REMOVE
        await app
          .service(service as any)
          .remove(item._id, { provider: undefined, fromSync: true } as any)
          .catch(() => undefined)
        applied++
        details.push({ service, entityId: item._id, op, status: SyncRunRecordStatus.ACCEPTED })
        continue
      }
      // `_deletedAt` ist Cloud-only Soft-Delete-Zustand: Tombstones reisen als
      // `deletedAt` im Wire-Envelope (oben behandelt), aber eine je getombstonte
      // und wieder resurrectete Cloud-Row behaelt `_deletedAt: null` als Feld im
      // Dokument. Die geteilten Data-Schemas sind `additionalProperties: false`
      // und kennen `_deletedAt` nicht → ohne Strip lehnt validateData den ganzen
      // Record terminal ab (Befund 2026-07-28: opening-hour-exceptions).
      // Defensiv hier UND in der Cloud-Projektion (sync.ts) gestrippt, damit der
      // Edge nicht von der Cloud-Deploy-Reihenfolge abhaengt.
      const { _deletedAt: _cloudSoftDelete, ...cleanRecord } = (item.record ?? {}) as Record<string, unknown>
      const withoutLegacyDiscount = stripLegacyOrderDiscount(service, cleanRecord, item._id)
      const incoming = service === 'users' ? stripUserEdgeLocalFields(withoutLegacyDiscount) : withoutLegacyDiscount
      // 🚫 ERKENNEN, NICHT ABLEHNEN. Der Record wird unten geschrieben wie jeder
      // andere. Das ist keine Nachlaessigkeit, sondern die Bedingung dafuer, dass der
      // Guard ueberhaupt gebaut werden durfte: `upsertCursor` im Scheduler rueckt
      // unabhaengig vom Apply-Ergebnis vor, ein hier abgelehnter Record kaeme NIE
      // wieder — stiller Totalverlust statt verzoegertem Retry. Ein Guard, der in
      // jeder Fehlalarm-Lage (Re-Pairing vor Restamp, Bootstrap-Reihenfolge, Edge ohne
      // gesetzte `connection.tenantId`) eine ganze Pull-Seite dauerhaft verschwinden
      // laesst, waere gefaehrlicher als die Luecke, die er schliesst.
      //
      // Ob schaerfer abgelehnt werden darf, entscheidet die Messung: Taucht
      // `sync.pull.foreign_tenant_record` im Betrieb nie auf, ist der Fall
      // ausgeschlossen — dieselbe Logik, mit der `sync.pull.legacy_discount_stripped`
      // eingefuehrt wurde.
      const foreignTenantId = detectForeignTenantId(options.expectedTenantId, incoming)
      if (foreignTenantId) {
        foreignTenant++
        lastForeignTenantId = foreignTenantId
        if (foreignSampleIds.length < 5) foreignSampleIds.push(item._id)
      }
      if (existingIds.has(item._id)) {
        op = SyncOp.PATCH
        await app
          .service(service as any)
          .patch(item._id, incoming as any, { provider: undefined, fromSync: true } as any)
      } else {
        op = SyncOp.CREATE
        await app.service(service as any).create(incoming as any, { provider: undefined, fromSync: true } as any)
      }
      applied++
      details.push({ service, entityId: item._id, op, status: SyncRunRecordStatus.ACCEPTED })
    } catch (err) {
      rejected++
      logger.warn({
        message: 'Pull-Apply fehlgeschlagen',
        event: 'sync.pull.apply_failed',
        service,
        entityId: item._id,
        errorMessage: err instanceof Error ? err.message : String(err),
        validationErrors: extractAjvValidationErrors(err),
      })
      details.push({
        service,
        entityId: item._id,
        op,
        status: SyncRunRecordStatus.REJECTED,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (foreignTenant > 0 && lastForeignTenantId) {
    // 🚨 Ein Treffer ist KEIN Sync-Problem. Er bedeutet, dass die Cloud-Filterung,
    // das ausgestellte Edge-Token oder eine `applyScope`-Strategie einen fremden
    // Mandanten durchgelassen hat — der Edge ist hier nur der Zeuge.
    logger.warn({
      message: `Pull-Apply: ${foreignTenant} von ${records.length} Records tragen eine fremde tenantId — angewandt, aber gemeldet`,
      event: 'sync.pull.foreign_tenant_record',
      service,
      expectedTenantId: options.expectedTenantId,
      foreignTenantId: lastForeignTenantId,
      count: foreignTenant,
      sampleEntityIds: foreignSampleIds,
    })
    await stampForeignTenantLatch(app, {
      count: foreignTenant,
      lastForeignTenantId,
      connectionId: options.connectionId,
    })
  }
  return { applied, rejected, details, foreignTenant }
}
