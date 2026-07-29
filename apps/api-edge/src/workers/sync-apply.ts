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
import { SyncOp, type SyncPullResponse, type SyncRunRecordDetail, SyncRunRecordStatus } from '@panary/sync/domain'
import { stripUserEdgeLocalFields } from '@panary/users/domain'

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
}

export interface ApplyPulledRecordsResult {
  /** Erfolgreich angewandte Records (create + patch + remove). */
  applied: number
  /** Records, deren Apply fehlgeschlagen ist (z.B. Edge-Validator). */
  rejected: number
  /** Per-Record-Details fuer sync-run-Eintraege (ungekappt — Caller kappt). */
  details: SyncRunRecordDetail[]
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
  if (records.length === 0) return { applied, rejected, details }

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
      const incoming = service === 'users' ? stripUserEdgeLocalFields(cleanRecord) : cleanRecord
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
  return { applied, rejected, details }
}
