// Feathers-Mechanik der Re-Verifikation nach langer Offline-Phase
// (panary/panary-core#325). Die fachlichen Regeln liegen in
// @panary/devices/domain (`device-reverification.ts`) — hier steht nur, wie der
// Edge sie an Standort-Einstellungen, Connection und Audit-Trail anschliesst.
//
// Muster wie `device-access-mode.util.ts`: kein Cache. Die Aufloesung laeuft
// einmal pro Socket-Handshake, nicht pro Bon.
import { uuidv7 } from 'uuidv7'

import { AuditAction, AuditCategory, AuditOutcome, AuditSeverity } from '@panary/audit-events/domain'
import {
  isDeviceReverificationDue,
  resolveDeviceOfflineForMs,
  resolveDeviceReverifyThresholdMs,
} from '@panary/devices/domain'
import { logger } from '@panary/shared-backend'
import { DEVICE_REVERIFY_AUTHORIZING_ROLES } from '@panary/users/domain'

import type { Application } from '../declarations'
import { stampApiKeyLastUsed } from './apikey-last-used'

/** Merkmale, die der Handshake auf die Socket-Connection stempelt. */
export interface DeviceReverificationConnectionState {
  requiresReverification?: boolean
  reverificationOfflineSince?: string | null
  reverificationOfflineForMs?: number | null
  /**
   * Die zum Zeitpunkt des Handshakes GELTENDE Schwelle. Wird mitgeschleppt,
   * damit das Freigabe-Audit die tatsaechlich angewandte Frist nennt und nicht
   * den Default — sonst behauptete der Trail „7 Tage", wo der Standort 14
   * konfiguriert hatte.
   */
  reverificationThresholdMs?: number
  apiKeyId?: string
}

export interface DeviceReverificationVerdict {
  due: boolean
  /** Dauer der Pause in Millisekunden, soweit messbar. */
  offlineForMs: number | null
  thresholdMs: number
}

const asArray = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : ((result as { data?: T[] } | undefined)?.data ?? [])

/**
 * Liest die Schwelle des Standorts. Faellt bei jedem Problem auf den Default
 * zurueck: Eine nicht lesbare Einstellung darf nie dazu fuehren, dass ein
 * Terminal haerter behandelt wird als konfiguriert.
 */
const loadThresholdMs = async (app: Application, locationId: string | undefined): Promise<number> => {
  if (!locationId) return resolveDeviceReverifyThresholdMs(undefined)

  try {
    const result = await app.service('locations').find({
      query: { _id: locationId, $limit: 1 },
      provider: undefined,
    } as never)
    const settings = asArray<{ settings?: { deviceSecuritySettings?: unknown } }>(result)[0]?.settings
    return resolveDeviceReverifyThresholdMs(
      (settings as { deviceSecuritySettings?: { offlineReverifyDays?: unknown } } | undefined)
        ?.deviceSecuritySettings,
    )
  } catch (err) {
    logger.warn({
      message: 'Schwelle fuer Geraete-Re-Verifikation nicht lesbar — Default greift',
      event: 'device.reverification_threshold_unreadable',
      locationId,
      error: String(err),
    })
    return resolveDeviceReverifyThresholdMs(undefined)
  }
}

/**
 * Beurteilt einen frisch authentifizierten Schluessel.
 *
 * 🚨 `lastUsedAt` MUSS der Wert VOR `stampApiKeyLastUsed` sein — sonst misst
 * die Regel ihren eigenen Stempel und loest nie aus. Der Aufrufer reicht den
 * Datensatz durch, wie `authenticateDeviceApiKey` ihn geladen hat; die
 * Schluessel-Rotation (ADR 0042) fasst `lastUsedAt` nicht an und kann das
 * Ergebnis daher auch dann nicht zuruecksetzen, wenn sie im selben Handshake
 * laeuft.
 */
export const evaluateDeviceReverification = async (
  app: Application,
  record: { locationId?: string; lastUsedAt?: string | null },
  now: number = Date.now(),
): Promise<DeviceReverificationVerdict> => {
  const thresholdMs = await loadThresholdMs(app, record.locationId)
  return {
    due: isDeviceReverificationDue(record.lastUsedAt, now, thresholdMs),
    offlineForMs: resolveDeviceOfflineForMs(record.lastUsedAt, now),
    thresholdMs,
  }
}

const hours = (ms: number | null): number | null => (ms === null ? null : Math.round(ms / 3_600_000))

/**
 * Schreibt ein Audit-Event zur Re-Verifikation.
 *
 * Bewusst bestehende `AuditAction`-Werte statt neuer Enum-Eintraege:
 * `audit-events` werden in die Cloud gepusht und dort gegen dasselbe — aber
 * aelter gepinnte — Enum validiert; ein unbekannter Wert wuerde den Sync
 * terminal rejecten (ohne Retry, ohne `sync-conflicts`-Eintrag). Der genaue
 * Vorgang steht deshalb in `metadata.reason`. Praezedenzfall:
 * `recordOrphanDiscardAudit` in `services/business-days/business-days.ts`.
 *
 * Fire-and-forget mit try/catch: Audit-Verlust ist hinnehmbar, der Auth- bzw.
 * Freigabe-Pfad darf daran nie scheitern.
 */
const recordReverificationAudit = async (
  app: Application,
  params: {
    tenantId: string
    locationId?: string | null
    deviceId: string
    actor: { userId: string; role: string }
    action: (typeof AuditAction)[keyof typeof AuditAction]
    outcome: (typeof AuditOutcome)[keyof typeof AuditOutcome]
    severity: (typeof AuditSeverity)[keyof typeof AuditSeverity]
    reason: string
    metadata: Record<string, unknown>
  },
): Promise<void> => {
  try {
    const correlationId = uuidv7()
    await (app.service('audit-events') as any).create(
      {
        _id: uuidv7(),
        tenantId: params.tenantId,
        locationId: params.locationId ?? null,
        occurredAt: new Date().toISOString(),
        actor: {
          userId: params.actor.userId,
          role: params.actor.role,
          deviceId: params.deviceId,
          requestId: correlationId,
        },
        target: {
          resource: 'devices',
          entityType: 'device',
          entityId: params.deviceId,
        },
        action: params.action,
        category: AuditCategory.ACCESS,
        outcome: params.outcome,
        severity: params.severity,
        metadata: { reason: params.reason, ...params.metadata },
        correlationId,
        // Flache Index-Spalten wie in record-audit-event.hook.ts.
        actor_userId: params.actor.userId,
        target_resource: 'devices',
        target_entityType: 'device',
        target_entityId: params.deviceId,
      },
      { provider: undefined },
    )
  } catch (err) {
    logger.warn({
      message: 'Audit-Event zur Geraete-Re-Verifikation konnte nicht geschrieben werden',
      event: 'device.reverification_audit_failed',
      deviceId: params.deviceId,
      reason: params.reason,
      error: String(err),
    })
  }
}

/** Auslösung: Das Geraet war zu lange weg und schuldet eine Bestaetigung. */
export const recordReverificationRequired = async (
  app: Application,
  record: { deviceId: string; tenantId: string; locationId?: string | null; role: string },
  verdict: DeviceReverificationVerdict,
): Promise<void> => {
  logger.warn({
    message: 'Geraet war zu lange offline — Bestaetigung faellig',
    event: 'device.reverification_required',
    deviceId: record.deviceId,
    tenantId: record.tenantId,
    locationId: record.locationId,
    offlineForHours: hours(verdict.offlineForMs),
    thresholdHours: hours(verdict.thresholdMs),
  })

  await recordReverificationAudit(app, {
    tenantId: record.tenantId,
    locationId: record.locationId,
    deviceId: record.deviceId,
    // Es gibt noch keine Person — der Handshake kennt nur das Geraet. Format
    // `device:<uuid>` wie in `allow-apikey.hook.ts`; genau deshalb traegt
    // `auditActorSchema.userId` kein `format: 'uuid'`.
    actor: { userId: `device:${record.deviceId}`, role: record.role },
    // LOGIN_FAILED ist der einzige ACCESS-Wert mit FAILURE-Semantik im
    // gepinnten Enum. Zutreffend ist er trotzdem: Der betriebliche Zugriff des
    // Geraets wurde verweigert. Der praezise Vorgang steht in `metadata.reason`.
    action: AuditAction.LOGIN_FAILED,
    outcome: AuditOutcome.FAILURE,
    severity: AuditSeverity.WARNING,
    reason: 'device-reverification-required',
    metadata: {
      offlineForHours: hours(verdict.offlineForMs),
      thresholdHours: hours(verdict.thresholdMs),
    },
  })
}

/** Freigabe: Eine Person hat das Geraet per PIN zurueckgeholt. */
export const recordReverificationGranted = async (
  app: Application,
  record: { deviceId: string; tenantId: string; locationId?: string | null },
  actor: { userId: string; role: string },
  verdict: { offlineForMs: number | null; thresholdMs: number },
  emergency: boolean,
): Promise<void> => {
  logger.warn({
    message: emergency
      ? 'Geraete-Re-Verifikation per NOTFREIGABE erteilt — Konto ohne Leitungsrolle'
      : 'Geraete-Re-Verifikation erteilt',
    event: 'device.reverification_granted',
    deviceId: record.deviceId,
    tenantId: record.tenantId,
    locationId: record.locationId,
    entityId: actor.userId,
    userRole: actor.role,
    emergency,
    offlineForHours: hours(verdict.offlineForMs),
  })

  await recordReverificationAudit(app, {
    tenantId: record.tenantId,
    locationId: record.locationId,
    deviceId: record.deviceId,
    actor,
    // Wortwoertlich zutreffend: Es WURDE eine PIN geprueft.
    action: AuditAction.PIN_VERIFY,
    outcome: AuditOutcome.SUCCESS,
    // Die Notfreigabe ist der Vorgang, den jemand im Nachhinein sehen soll —
    // deshalb ALERT und nicht NOTICE. Sie ist der Preis dafuer, dass das
    // Terminal nie stehen bleibt; unsichtbar waere sie ein Freibrief.
    severity: emergency ? AuditSeverity.ALERT : AuditSeverity.NOTICE,
    reason: emergency ? 'device-reverification-emergency-granted' : 'device-reverification-granted',
    metadata: {
      emergency,
      offlineForHours: hours(verdict.offlineForMs),
      thresholdHours: hours(verdict.thresholdMs),
    },
  })
}

/**
 * Hebt eine ausstehende Bestaetigung auf, nachdem `users.verifyPin` einen
 * korrekten PIN bestaetigt hat (panary/panary-core#325).
 *
 * Zwei Wege hinein, beide gewollt:
 *  - Leitungsrolle (`DEVICE_REVERIFY_AUTHORIZING_ROLES`) → regulaere Freigabe.
 *  - Jedes andere gueltige Konto → **Notfreigabe**, mit `AuditSeverity.ALERT`.
 *    Grund: Nach Betriebsferien steht morgens um sechs jemand vor dem Terminal,
 *    der keine Leitungs-PIN hat. Ein Terminal, das dann stehen bleibt, kostet
 *    einen Betriebstag — und gegen jemanden, der Geraet UND gueltige PIN hat,
 *    schuetzt die Abfrage ohnehin nicht (dafuer ist `active: false` der Weg).
 *    Sichtbar bleibt der Sonderfall trotzdem.
 *
 * Schluckt jeden Fehler: Eine misslungene Freigabe darf eine gueltige
 * PIN-Verifikation nicht in einen Fehler verwandeln — der Bediener stuende
 * sonst vor einem Bildschirm, der „PIN falsch" sagt, obwohl sie richtig war.
 * Das Merkmal bleibt dann stehen und der naechste Versuch loest es erneut aus.
 */
export const releaseDeviceReverification = async (
  app: Application,
  user: { _id?: string; role?: string; tenantId?: string | null },
  params?: { connection?: unknown },
): Promise<void> => {
  const conn = params?.connection as
    | (DeviceReverificationConnectionState & { deviceId?: string; tenantId?: string; locationId?: string })
    | undefined
  if (!conn || conn.requiresReverification !== true) return

  try {
    if (!conn.deviceId || !conn.tenantId) return

    // `verifyPin` laedt den User mit `provider: undefined` und prueft den
    // Mandanten NICHT (anders als `changePin`). Fuer eine Freigabe waere das
    // die falsche Stelle, das zu ignorieren.
    if (user.tenantId && user.tenantId !== conn.tenantId) {
      logger.warn({
        message: 'Freigabe abgelehnt: Konto gehoert nicht zum Mandanten des Geraets',
        event: 'security.device_reverification_foreign_tenant',
        deviceId: conn.deviceId,
        tenantId: conn.tenantId,
      })
      return
    }

    const role = user.role ?? 'unknown'
    const emergency = !DEVICE_REVERIFY_AUTHORIZING_ROLES.has(role)
    const verdict = {
      offlineForMs: conn.reverificationOfflineForMs ?? null,
      thresholdMs: conn.reverificationThresholdMs ?? resolveDeviceReverifyThresholdMs(undefined),
    }

    // Erst das Merkmal loesen, dann stempeln: Faellt der Stempel aus, ist das
    // Terminal trotzdem bedienbar, und der naechste Handshake loest hoechstens
    // ein zweites Mal aus — das ist die harmlosere Richtung.
    conn.requiresReverification = false
    conn.reverificationOfflineSince = null
    conn.reverificationOfflineForMs = null

    // Erzwungen, nicht gedrosselt: Ein Reconnect innerhalb der naechsten fuenf
    // Minuten darf nicht erneut auf den alten `lastUsedAt` treffen.
    if (conn.apiKeyId) stampApiKeyLastUsed(app, conn.apiKeyId, { force: true })

    await recordReverificationGranted(
      app,
      { deviceId: conn.deviceId, tenantId: conn.tenantId, locationId: conn.locationId ?? null },
      { userId: user._id ?? 'unknown', role },
      verdict,
      emergency,
    )
  } catch (err) {
    logger.warn({
      message: 'Freigabe der Geraete-Re-Verifikation fehlgeschlagen',
      event: 'device.reverification_release_failed',
      deviceId: conn.deviceId,
      error: String(err),
    })
  }
}
