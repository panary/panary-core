import { logger } from '@panary/shared-backend'

import type { CloudConnection } from '@panary/cloud-connection/domain'
import type { SyncHeartbeatResponse } from '@panary/sync/domain'

export type MinVersions = {
  requiredEdgeMinVersion: string | null
  requiredPosMinVersion: string | null
}

// Gleiche Obergrenze wie das Antwortschema (`syncHeartbeatResponseSchema`).
const MAX_VERSION_LENGTH = 50

/** Ein Text bis 50 Zeichen ist eine Mindestversion, alles andere (fehlend, leer, Zahl, zu lang) heißt „keine". */
const readVersion = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_VERSION_LENGTH ? trimmed : null
}

/**
 * Liest die Mindestversionen aus einer erfolgreichen Heartbeat-Antwort (core#1440, ADR 0070).
 *
 * Die Antwort wird ohne Schemaprüfung gecastet, also traut dieser Leser nichts: Alles Unbrauchbare wird `null`.
 * `null` ist hier die Aussage der Cloud „keine Mindestversion gesetzt" — auch eine ältere Cloud, die die Felder
 * nicht kennt, sagt das. Bei Funkstille gibt es keine Antwort und damit auch keinen Aufruf: Der letzte Wert bleibt.
 */
export const readMinVersions = (body: Partial<SyncHeartbeatResponse> | null | undefined): MinVersions => ({
  requiredEdgeMinVersion: readVersion(body?.requiredEdgeMinVersion),
  requiredPosMinVersion: readVersion(body?.requiredPosMinVersion),
})

/**
 * Hält die zuletzt gesehenen Mindestversionen in der `cloud-connection` fest — nur bei Änderung, nie öfter.
 *
 * VOLLSTAENDIG FEHLER-ISOLIERT: wirft nie. `runHeartbeat` trägt die Token-Rotation, und drei Fehlschläge
 * aktivieren den Notfall-Modus der Edge — eine Auskunftsspalte darf das niemals auslösen. Deshalb auch ein
 * eigener Patch statt eines Felds im Heartbeat-Patch: Scheitert er, bleibt der Heartbeat erfolgreich.
 */
export const persistMinVersions = async (
  app: { service: (path: string) => unknown },
  connection: Pick<CloudConnection, '_id' | 'requiredEdgeMinVersion' | 'requiredPosMinVersion'>,
  body: Partial<SyncHeartbeatResponse> | null | undefined,
): Promise<void> => {
  try {
    const next = readMinVersions(body)
    const current: MinVersions = {
      requiredEdgeMinVersion: connection.requiredEdgeMinVersion ?? null,
      requiredPosMinVersion: connection.requiredPosMinVersion ?? null,
    }
    if (
      next.requiredEdgeMinVersion === current.requiredEdgeMinVersion &&
      next.requiredPosMinVersion === current.requiredPosMinVersion
    ) {
      return
    }
    // Interner Aufruf direkt am Adapter wie die übrigen Heartbeat-Patches (`_patch`, ohne Hooks).
    await (app.service('cloud-connection') as { _patch: (id: string, data: MinVersions) => Promise<unknown> })._patch(
      connection._id,
      next,
    )
  } catch (err) {
    logger.warn({
      message: 'Mindestversionen aus der Heartbeat-Antwort konnten nicht gespeichert werden',
      event: 'sync.heartbeat.min_versions_failed',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
