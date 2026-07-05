// Audit-Cleanup-Worker (Phase 2).
//
// Loescht nightly Audit-Events, die aelter als `retentionDays` sind UND vom
// Cloud-Sync mit `acked` bestaetigt wurden. Cloud ist Source-of-Truth fuer die
// GoBD-pflichtigen 10 Jahre — Edge haelt nur die letzten 90 Tage hot.
//
// Append-only-Garantie: Der Worker dropt die SQLite-Trigger fuer DELETE in
// einer Knex-Transaktion, fuehrt das DELETE aus und legt den Trigger im selben
// Transaction-Block wieder an. Bei Crash zwischen DROP und CREATE: Rollback,
// Trigger bleiben aktiv (kein Datenverlust, kein Trigger-Verlust).
//
// Pre-Check: Wenn die Cloud seit > 7 Tagen nicht erreichbar war (kein Eintrag
// in `cloud-connection.lastSyncAt` innerhalb dieses Fensters), wird der
// Cleanup-Lauf uebersprungen. Vermeidet Datenverlust bei laengerem Sync-Ausfall.
//
// Audit-Trail: Jeder Cleanup-Lauf erzeugt selbst einen Audit-Event mit
// `action: AUDIT_CLEANUP`, der die geloeschte Anzahl + Zeitfenster dokumentiert.
//
// Phase 2 im selben Nightly-Lauf: Outbox-Retention. `acked` sync-outbox-
// Eintraege (Voll-Payload-Kopie jeder Mutation) wuerden sonst unbegrenzt
// wachsen. Fremde Services nach OUTBOX_ACKED_RETENTION_DAYS; audit-events-
// Eintraege erst nach Audit-Retention + Karenz UND nachdem das Event selbst
// geloescht wurde — die acked-Row ist der Loeschbarkeits-Beweis des Cleanups.
import { uuidv7 } from 'uuidv7'

import {
  AuditAction,
  AuditCategory,
  AuditOutcome,
  AuditSeverity,
  type AuditEventData,
} from '@panary/audit-events/domain'
import { logger } from '@panary/shared-backend'

import type { Application } from '../declarations'

interface AuditCleanupConfig {
  enabled: boolean
  retentionDays: number
  hour: number // 0-23, lokale Server-Zeit (Cron-Stunde)
  minuteJitterMs: number // Random-Delay vor jedem Run, vermeidet Cluster-Effekte
  cloudReachableMaxAgeDays: number // wenn lastSyncAt aelter ist → skip
  batchSize: number // wieviele rows pro Lauf maximal
}

const DEFAULT_CONFIG: AuditCleanupConfig = {
  enabled: true,
  retentionDays: 90,
  hour: 2,
  minuteJitterMs: 5 * 60 * 1000, // bis zu 5min Jitter
  cloudReachableMaxAgeDays: 7,
  batchSize: 1000,
}

const SKIP_PATHS = new Set(['audit-events', 'sync-outbox'])
void SKIP_PATHS // dokumentarisch — der Worker ruft keine dieser Services schreibend

// Retention fuer acked sync-outbox-Eintraege fremder Services (Phase 2 des
// Nightly-Laufs). 30 Tage decken die Operator-Diagnose im Sync-Status-UI ab;
// danach hat die Voll-Payload-Kopie am Edge keinen Zweck mehr — die Cloud
// hat den Push mit `acked` bestaetigt.
const OUTBOX_ACKED_RETENTION_DAYS = 30

// Karenz fuer acked audit-events-Eintraege OBEN AUF die Audit-Retention:
// die acked-Row ist der Loeschbarkeits-Beweis des Audit-Cleanups
// (EXISTS-Subquery in runAuditEventsPhase) und darf erst fallen, wenn das
// Event selbst sicher weggeraeumt ist.
const OUTBOX_AUDIT_ACK_GRACE_DAYS = 7

interface SchedulerHandle {
  stop: () => void
}

/**
 * Startet den Cleanup-Worker. Plant den naechsten Lauf zur konfigurierten
 * Stunde (lokale Zeit). Liefert ein Handle, das in Tests/Tear-Down gestoppt
 * werden kann.
 */
export const startAuditCleanupWorker = (
  app: Application,
  configOverride?: Partial<AuditCleanupConfig>,
): SchedulerHandle => {
  const config: AuditCleanupConfig = {
    ...DEFAULT_CONFIG,
    ...((app.get('auditCleanup') as Partial<AuditCleanupConfig> | undefined) ?? {}),
    ...(configOverride ?? {}),
  }

  if (!config.enabled) {
    logger.info({
      message: 'Audit-Cleanup-Worker deaktiviert (config.auditCleanup.enabled=false)',
      event: 'audit.cleanup.disabled',
    })
    return { stop: () => undefined }
  }

  let timer: NodeJS.Timeout | undefined
  let stopped = false

  const scheduleNext = () => {
    if (stopped) return
    const delayMs = computeDelayUntilHour(config.hour) + Math.random() * config.minuteJitterMs
    timer = setTimeout(() => {
      void runOnce(app, config).finally(scheduleNext)
    }, delayMs)
  }

  scheduleNext()
  logger.info({
    message: 'Audit-Cleanup-Worker gestartet',
    event: 'audit.cleanup.scheduled',
    retentionDays: config.retentionDays,
    hour: config.hour,
  })

  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}

/**
 * Fuehrt einen einzelnen Cleanup-Lauf aus (Audit-Events + Outbox-Retention).
 * Exportiert fuer Tests und manuelle Trigger (z.B. via Custom-Method spaeter).
 */
export const runOnce = async (app: Application, config: AuditCleanupConfig): Promise<void> => {
  await runAuditEventsPhase(app, config)
  await runOutboxRetentionPhase(app, config)
}

const runAuditEventsPhase = async (app: Application, config: AuditCleanupConfig): Promise<void> => {
  const startedAt = Date.now()
  try {
    if (!(await isCloudReachableRecently(app, config.cloudReachableMaxAgeDays))) {
      logger.warn({
        message: 'Audit-Cleanup uebersprungen — Cloud zu lange nicht erreichbar',
        event: 'audit.cleanup.skipped',
        reason: 'cloud_unreachable',
      })
      return
    }

    const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000).toISOString()
    const knex = app.get('sqliteClient') as
      | (import('knex').Knex & ((table: string) => unknown))
      | undefined
    if (!knex) {
      logger.error({
        message: 'Audit-Cleanup abgebrochen — kein sqliteClient verfuegbar',
        event: 'audit.cleanup.no_db',
      })
      return
    }

    // Eligible: aelter als cutoff UND in sync-outbox als acked vermerkt.
    // Nutzt Subquery, damit pending-sync-Eintraege niemals geloescht werden.
    const eligibleRows = (await knex.raw(
      `
      SELECT a._id, a.tenantId, a.locationId
      FROM "audit-events" a
      WHERE a.occurredAt < ?
        AND EXISTS (
          SELECT 1 FROM "sync-outbox" o
          WHERE o.service = 'audit-events'
            AND o.entityId = a._id
            AND o.status = 'acked'
        )
      LIMIT ?
      `,
      [cutoff, config.batchSize],
    )) as Array<{ _id: string; tenantId: string; locationId: string | null }>

    if (eligibleRows.length === 0) {
      logger.info({
        message: 'Audit-Cleanup: keine zu loeschenden Eintraege',
        event: 'audit.cleanup.noop',
        cutoff,
      })
      return
    }

    const ids = eligibleRows.map(r => r._id)

    // Transaktional: Trigger droppen, DELETE, Trigger wieder anlegen.
    // Bei Crash zwischen DROP und CREATE rollt SQLite die Transaktion zurueck
    // — der Trigger bleibt aktiv. Der Cleanup-Job ist die einzige erlaubte
    // Stelle, an der die Append-only-Garantie temporaer ausgesetzt wird.
    await knex.transaction(async trx => {
      await trx.raw('DROP TRIGGER IF EXISTS audit_events_no_delete')
      try {
        await trx('audit-events').whereIn('_id', ids).del()
      } finally {
        await trx.raw(`
          CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
          BEFORE DELETE ON "audit-events"
          BEGIN
            SELECT RAISE(FAIL, 'audit-events ist append-only — DELETE nicht erlaubt');
          END;
        `)
      }
    })

    // Audit-Cleanup-Aktion selbst auditieren — pro Tenant ein Eintrag, weil
    // sich Eintraege auf mehrere Tenants verteilen koennen (Multi-Tenant-Edge
    // bei Cloud-Edge-Pairing-Setups).
    const byTenant = new Map<string, { count: number; locationId: string | null }>()
    for (const row of eligibleRows) {
      const entry = byTenant.get(row.tenantId)
      if (entry) entry.count += 1
      else byTenant.set(row.tenantId, { count: 1, locationId: row.locationId })
    }

    for (const [tenantId, info] of byTenant.entries()) {
      const event: AuditEventData = {
        _id: uuidv7(),
        tenantId,
        locationId: info.locationId,
        occurredAt: new Date().toISOString(),
        actor: {
          userId: 'system:audit-cleanup',
          role: 'system',
          requestId: uuidv7(),
        },
        target: {
          resource: 'audit-events',
          entityType: 'audit-event-batch',
          entityId: 'batch:' + new Date().toISOString().slice(0, 10),
        },
        action: AuditAction.AUDIT_CLEANUP,
        category: AuditCategory.CONFIGURATION,
        outcome: AuditOutcome.SUCCESS,
        severity: AuditSeverity.INFO,
        metadata: {
          deletedCount: info.count,
          retentionDays: config.retentionDays,
          cutoff,
        },
        correlationId: uuidv7(),
      }
      try {
        await app
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .service('audit-events' as any)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .create(event as any, { provider: undefined } as any)
      } catch (err) {
        logger.warn({
          message: 'AUDIT_CLEANUP-Selbst-Audit konnte nicht geschrieben werden',
          event: 'audit.cleanup.self_audit_failed',
          tenantId,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    }

    logger.info({
      message: 'Audit-Cleanup abgeschlossen',
      event: 'audit.cleanup.done',
      deletedCount: ids.length,
      tenantCount: byTenant.size,
      cutoff,
      durationMs: Date.now() - startedAt,
    })
  } catch (err) {
    logger.error({
      message: 'Audit-Cleanup mit Fehler abgebrochen',
      event: 'audit.cleanup.failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
      durationMs: Date.now() - startedAt,
    })
  }
}

export interface OutboxRetentionResult {
  deletedDefault: number
  deletedAuditEvents: number
  deletedSuperseded: number
}

/**
 * Loescht acked sync-outbox-Eintraege nach Retention-Ablauf. Reine, isoliert
 * testbare Funktion — arbeitet ausschliesslich auf der uebergebenen
 * Knex-Instanz und rechnet gegen `options.now`.
 *
 * Regeln:
 *  - `status='acked'` und `status='superseded'` (vom Push-Worker terminal
 *    uebersprungen, weil ein juengerer Eintrag derselben Entity existiert).
 *    pending/in-flight sind noch nicht gepusht; rejected haengt ggf. an einem
 *    sync-conflicts-Eintrag (linkedConflictId) und bleibt fuer die
 *    Operator-Aufloesung stehen.
 *  - Fremde Services: `syncedAt` aelter als OUTBOX_ACKED_RETENTION_DAYS;
 *    superseded-Eintraege analog ueber `terminalAt` (sie haben nie ein
 *    `syncedAt`). audit-events werden auch hier ausgenommen — superseded darf
 *    dort praktisch nie auftreten (append-only), im Zweifel bleibt die Row
 *    konservativ stehen.
 *  - `audit-events`: Die acked-Row ist der Loeschbarkeits-Beweis fuer den
 *    Audit-Cleanup (EXISTS-Subquery in runAuditEventsPhase). Sie darf erst
 *    fallen, wenn (a) `syncedAt` aelter als Audit-Retention + Karenz ist UND
 *    (b) das referenzierte Event lokal bereits geloescht wurde — sonst wird
 *    ein noch vorhandenes altes Event nie mehr loeschbar.
 *
 * Direkter Knex-DELETE folgt dem etablierten Cleanup-Worker-Muster dieser
 * Datei (Trigger-Bypass-Transaktion oben) bzw. sync-runs-cleanup.worker.ts.
 */
export const runOutboxRetention = async (
  knex: import('knex').Knex,
  options: { auditRetentionDays: number; now?: Date },
): Promise<OutboxRetentionResult> => {
  const nowMs = (options.now ?? new Date()).getTime()
  const defaultCutoff = new Date(nowMs - OUTBOX_ACKED_RETENTION_DAYS * 86_400_000).toISOString()
  const auditCutoff = new Date(
    nowMs - (options.auditRetentionDays + OUTBOX_AUDIT_ACK_GRACE_DAYS) * 86_400_000,
  ).toISOString()

  // `syncedAt` (Ack-Zeitpunkt) als Referenz — NULL-Werte matchen `< cutoff`
  // in SQLite nie und bleiben konservativ erhalten.
  const deletedDefault = await knex('sync-outbox')
    .where('status', 'acked')
    .whereNot('service', 'audit-events')
    .where('syncedAt', '<', defaultCutoff)
    .del()

  const deletedAuditEvents = await knex('sync-outbox')
    .where('status', 'acked')
    .where('service', 'audit-events')
    .where('syncedAt', '<', auditCutoff)
    .whereNotExists(
      knex
        .select(knex.raw('1'))
        .from('audit-events')
        .whereRaw('"audit-events"."_id" = "sync-outbox"."entityId"'),
    )
    .del()

  // Superseded-Eintraege haben kein syncedAt (nie gepusht) — `terminalAt`
  // (Supersede-Zeitpunkt) ist die Referenz. NULL-Werte matchen `< cutoff`
  // in SQLite nie und bleiben konservativ erhalten.
  const deletedSuperseded = await knex('sync-outbox')
    .where('status', 'superseded')
    .whereNot('service', 'audit-events')
    .where('terminalAt', '<', defaultCutoff)
    .del()

  return { deletedDefault, deletedAuditEvents, deletedSuperseded }
}

// Phase 2 des Nightly-Laufs. Bewusst NACH dem Audit-Cleanup: ein Event wird
// im selben Lauf erst geloescht, bevor sein acked-Beweis fallen darf. Kein
// Cloud-Reachability-Gate wie in Phase 1 — `acked` heisst, die Cloud hat den
// Push bereits bestaetigt; die Retention ist offline genauso sicher.
const runOutboxRetentionPhase = async (
  app: Application,
  config: AuditCleanupConfig,
): Promise<void> => {
  const startedAt = Date.now()
  try {
    const knex = app.get('sqliteClient') as import('knex').Knex | undefined
    if (!knex) {
      logger.error({
        message: 'Outbox-Retention abgebrochen — kein sqliteClient verfuegbar',
        event: 'sync.outbox.retention.no_db',
      })
      return
    }
    const result = await runOutboxRetention(knex, { auditRetentionDays: config.retentionDays })
    if (result.deletedDefault > 0 || result.deletedAuditEvents > 0 || result.deletedSuperseded > 0) {
      logger.info({
        message: 'Outbox-Retention abgeschlossen',
        event: 'sync.outbox.retention.done',
        deletedDefault: result.deletedDefault,
        deletedAuditEvents: result.deletedAuditEvents,
        deletedSuperseded: result.deletedSuperseded,
        durationMs: Date.now() - startedAt,
      })
    }
  } catch (err) {
    logger.error({
      message: 'Outbox-Retention mit Fehler abgebrochen',
      event: 'sync.outbox.retention.failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
      durationMs: Date.now() - startedAt,
    })
  }
}

// Liefert die Millisekunden bis zum naechsten Auftreten der gegebenen Stunde
// in lokaler Server-Zeit. `targetHour` 2 → naechster 02:00 lokal.
const computeDelayUntilHour = (targetHour: number): number => {
  const now = new Date()
  const target = new Date(now)
  target.setHours(targetHour, 0, 0, 0)
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }
  return target.getTime() - now.getTime()
}

// Cloud-Reachability-Check: liest cloud-connection.lastSyncAt und prueft, ob
// das Datum innerhalb der erlaubten Toleranz liegt. Wenn es keine
// cloud-connection gibt (Edge laeuft ohne Pairing), gilt der Edge als
// "standalone" — Cleanup laeuft trotzdem (Cloud-Source-of-Truth-Pflicht
// entfaellt).
const isCloudReachableRecently = async (
  app: Application,
  maxAgeDays: number,
): Promise<boolean> => {
  try {
    const result = (await app
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .service('cloud-connection' as any)
      .find({
        provider: undefined,
        paginate: false,
        query: { $limit: 1 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as unknown as Array<{
      lastSyncAt?: string
      pairingStatus?: string
    }>
    const conn = Array.isArray(result) ? result[0] : undefined
    if (!conn) return true // standalone Edge — keine Cloud, kein Sync-Risiko
    if (conn.pairingStatus !== 'connected') return true // ungepairt → standalone
    if (!conn.lastSyncAt) return false // gepairt aber nie gesynct → vorsichtshalber skip
    const ageMs = Date.now() - new Date(conn.lastSyncAt).getTime()
    return ageMs <= maxAgeDays * 86_400_000
  } catch {
    // Service nicht verfuegbar → behandeln wie standalone, damit Cleanup
    // nicht ewig blockiert wird, falls cloud-connection-Service Fehler wirft.
    return true
  }
}
