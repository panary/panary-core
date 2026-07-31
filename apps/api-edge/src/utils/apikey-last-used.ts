import { logger } from '@panary/shared-backend'
import type { Application } from '../declarations'

/**
 * Mindestabstand zwischen zwei `lastUsedAt`-Schreibvorgaengen pro API-Key.
 *
 * 5 Minuten, weil:
 *  - SQLite hat genau einen Writer. Der Print-Server-Pfad authentifiziert pro
 *    HTTP-Request; ungedrosselt wuerde jeder Druckauftrag den Write-Lock nehmen.
 *  - Die Frage, die das Feld im Admin beantwortet, ist „wird dieses Credential
 *    ueberhaupt noch benutzt" (Revocation-Hygiene) — nicht „ist das Geraet
 *    gerade online". Letzteres liefern `devices.lastSeen` (Connect/Disconnect)
 *    und der `device-connections`-Service (Live-Socket-Registry) bereits exakt.
 */
const STAMP_INTERVAL_MS = 5 * 60 * 1000

/**
 * apiKeyId → Zeitpunkt des letzten geschriebenen Stempels (prozess-lokal).
 * Die Map-Groesse ist durch die Anzahl existierender API-Keys begrenzt (Dutzende),
 * daher kein Pruning noetig. Ein Neustart leert sie — Kosten: ein zusaetzlicher
 * Write pro Key nach dem Boot.
 */
const lastStampedAt = new Map<string, number>()

/**
 * Stempelt `apikeys.lastUsedAt` auf jetzt — gedrosselt, fire-and-forget.
 *
 * Nur bei ERFOLGREICHER Authentifizierung aufrufen: ein Stempel auf Fehlversuche
 * waere ein Schreib-Amplifikator fuer beliebige Aufrufer.
 *
 * Der Schreibpfad laeuft bewusst ueber die Feathers-Adapter-API (code-style.md
 * §6), obwohl der WS-Handshake den Key selbst per rohem Knex liest. Ein Fehler
 * darf den Auth-Pfad nie beeinflussen — Muster wie `stampDeviceLastSeen`
 * in `channels.ts`.
 *
 * `apikeys` steht in keiner Sync-Allowlist → kein Outbox-/Cloud-Push. Sollte der
 * Service je synchronisiert werden, erzeugt der `updatedAt`-Bump dieses Patches
 * Sync-Rauschen im Throttle-Takt; dann auf `_patch` umstellen (umgeht die
 * Hook-Kette inkl. `updatedAt`-Resolver).
 */
export const stampApiKeyLastUsed = (app: Application, apiKeyId: string): void => {
  if (!apiKeyId) return

  const now = Date.now()
  const previous = lastStampedAt.get(apiKeyId)
  if (previous !== undefined && now - previous < STAMP_INTERVAL_MS) return

  // Vor dem await setzen: zwei parallele Handshakes duerfen nicht beide schreiben.
  lastStampedAt.set(apiKeyId, now)

  void (async () => {
    try {
      await app
        .service('apikeys')
        .patch(apiKeyId, { lastUsedAt: new Date().toISOString() } as any, { provider: undefined } as any)
    } catch (err) {
      // Rollback, sonst blockiert der Fehlversuch den naechsten Stempel 5 Minuten.
      lastStampedAt.delete(apiKeyId)
      logger.warn({
        message: 'Failed to stamp apikey lastUsedAt',
        event: 'apikey.last_used_error',
        apiKeyId,
        error: String(err),
      })
    }
  })()
}

/** Nur fuer Tests — prozess-lokalen Throttle-State zuruecksetzen. */
export const __resetApiKeyLastUsedThrottle = (): void => lastStampedAt.clear()
