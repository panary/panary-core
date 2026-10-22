import { ConnectionService } from '@panary/shared/data-access'

type PairingStatus = 'connected' | 'disconnected' | 'pairing' | 'error'

/**
 * Kopplungsstatus der Edge zur Cloud, wie Dashboard und Statuszeile ihn zeigen.
 * 'stale' = gekoppelt (pairingStatus=connected), aber seit > CLOUD_CONTACT_STALE_SEC
 * kein Cloud-Kontakt → Cloud aktuell nicht erreichbar.
 */
export type CloudStatus = 'standalone' | 'stale' | PairingStatus

export interface CloudConnection {
  _id: string
  pairingStatus: PairingStatus
  lastCloudContactAt?: string | null
}

// Zentrale Schwelle aus dem ConnectionService — identisch zu Cloud-Status-Banner
// und Cloud-Kopplung-Live-Status (Konsistenz über alle Oberflächen).
const CLOUD_CONTACT_STALE_SEC = ConnectionService.CLOUD_CONTACT_STALE_SEC

/**
 * Leitet den ECHTEN Kopplungsstatus aus dem cloud-connection-Datensatz ab —
 * NICHT aus der statischen system.mode-Config (die /health als systemMode
 * liefert und unabhängig vom Pairing 'standalone' bleiben kann).
 */
export function deriveCloudStatus(conn: CloudConnection | undefined, nowMs: number): CloudStatus {
  if (!conn) return 'standalone'
  switch (conn.pairingStatus) {
    case 'pairing':
      return 'pairing'
    case 'error':
      return 'error'
    case 'connected': {
      const last = conn.lastCloudContactAt ? new Date(conn.lastCloudContactAt).getTime() : null
      if (last === null) return 'stale'
      return (nowMs - last) / 1000 > CLOUD_CONTACT_STALE_SEC ? 'stale' : 'connected'
    }
    // 'disconnected' = entkoppelt / zurückgesetzt → kein Cloud-Modus.
    default:
      return 'standalone'
  }
}
