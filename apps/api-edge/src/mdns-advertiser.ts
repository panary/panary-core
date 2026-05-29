import os from 'os'
// bonjour-service nutzt `export = Bonjour` (CJS) → Default-Import (esModuleInterop).
import Bonjour from 'bonjour-service'
import { logger } from '@panary/shared-backend'

/**
 * mDNS-Advertising fuer den Edge-Server.
 *
 * Macht den Hub im lokalen Netzwerk als `_panary._tcp` auffindbar, damit der
 * POS-Setup-Wizard ihn ohne manuelle IP-Eingabe entdecken kann. Die
 * TXT-Records transportieren genug Kontext, um den Hub in der Geraeteliste
 * direkt mit Betriebsname und Setup-Status anzuzeigen, ohne ihn vorher per
 * HTTP zu proben.
 *
 * Best-effort: Schlaegt das Publizieren fehl (blockiertes Multicast, fehlende
 * Netzwerk-Interfaces, Firewall auf UDP 5353), laeuft der Edge normal weiter —
 * QR-Code und manuelle IP-Eingabe bleiben als Fallback im Wizard nutzbar.
 */
export interface MdnsAdvertiseOptions {
  port: number
  version?: string
  organizationName?: string
  setupComplete: boolean
  systemMode?: string
  locationId?: string
}

/** Service-Typ ohne Unterstrich/Protokoll — bonjour-service bildet daraus `_panary._tcp.local`. */
const SERVICE_TYPE = 'panary'

let bonjour: Bonjour | null = null
let service: ReturnType<Bonjour['publish']> | null = null
let shutdownHooksRegistered = false

export function startMdnsAdvertising(opts: MdnsAdvertiseOptions): void {
  try {
    // Re-Publish ist idempotent: vorhandenen Eintrag erst sauber abmelden.
    stopMdnsAdvertising()

    bonjour = new Bonjour()
    const displayName = opts.organizationName
      ? `Panary Hub – ${opts.organizationName}`
      : `Panary Hub – ${os.hostname()}`

    service = bonjour.publish({
      name: displayName,
      type: SERVICE_TYPE,
      protocol: 'tcp',
      port: opts.port,
      txt: {
        version: opts.version ?? '0.0.0',
        organizationName: opts.organizationName ?? '',
        setupComplete: opts.setupComplete ? 'true' : 'false',
        systemMode: opts.systemMode ?? 'standalone',
        locationId: opts.locationId ?? '',
        hostname: os.hostname(),
      },
    })

    registerShutdownHooks()

    logger.info({
      message: `mDNS-Advertising aktiv: _${SERVICE_TYPE}._tcp auf Port ${opts.port}`,
      event: 'mdns.advertise_start',
      port: opts.port,
      setupComplete: opts.setupComplete,
    })
  } catch (err) {
    logger.warn({
      message:
        'mDNS-Advertising konnte nicht gestartet werden — Auto-Discovery deaktiviert (QR/manuell bleiben verfuegbar).',
      event: 'mdns.advertise_failed',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export function stopMdnsAdvertising(): void {
  try {
    service?.stop?.()
  } catch {
    // ignore — Shutdown darf nie failen
  }
  service = null
  try {
    bonjour?.unpublishAll?.()
    bonjour?.destroy?.()
  } catch {
    // ignore — Shutdown darf nie failen
  }
  bonjour = null
}

function registerShutdownHooks(): void {
  if (shutdownHooksRegistered) return
  shutdownHooksRegistered = true
  // Goodbye-Pakete sind best-effort; der TTL der mDNS-Records raeumt verwaiste
  // Eintraege ohnehin ab.
  process.once('exit', () => stopMdnsAdvertising())
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopMdnsAdvertising()
      process.exit(0)
    })
  }
}
