import { logger } from '@panary/shared-backend'

import type { Application } from '../declarations'

/**
 * Ermittelt die Geraetezaehlung des Edge fuer den Cloud-Heartbeat.
 *
 * Der Edge weiss laengst, welche POS-Clients bei ihm haengen (Channel-Registry,
 * s. services/device-connections). Die Cloud kann es nicht wissen: die Clients
 * verbinden sich gegen den Edge, nie gegen die Cloud. Ohne diese Meldung zeigt
 * das Admin-Dashboard bei Edge-Kunden dauerhaft „0 verbunden", waehrend im Laden
 * verkauft wird.
 *
 * ⚠️ FAILURE-ISOLATION IST PFLICHT, nicht Hoeflichkeit.
 * `runHeartbeat` ist der Lebensnerv des Edge: Er traegt die Token-Rotation, und
 * drei aufeinanderfolgende Fehlschlaege (bzw. fuenf Minuten ohne OK) aktivieren
 * den Notfall-Modus der gesamten Edge. Diese Funktion darf deshalb unter keinen
 * Umstaenden werfen — im Zweifel `null` liefern und den Heartbeat ohne die
 * Telemetrie fliegen lassen. Eine Anzeige-Nebensache darf niemals den Sync
 * gefaehrden.
 */
export const collectDeviceCountsForHeartbeat = async (
  app: Application,
  tenantId: string | undefined,
): Promise<{ online: number; total: number } | null> => {
  if (!tenantId) return null
  try {
    // Ueber den bestehenden Service statt einer zweiten Zaehl-Implementierung:
    // er kapselt zusaetzlich die `total`-Ermittlung inkl. Degradationspfad
    // (DB-Fehler → total faellt auf online zurueck). Interner Call
    // (`provider: undefined`) passiert `authenticate` und `authorize()` —
    // letzteres steigt ohne provider frueh aus.
    const res = (await (app as any).service('device-connections').find({
      provider: undefined,
      user: { tenantId },
    })) as { online?: number; total?: number } | undefined

    const online = res?.online
    const total = res?.total
    if (typeof online !== 'number' || typeof total !== 'number') return null

    // `connectedDeviceIds` wird bewusst verworfen: die Cloud kann Edge-deviceIds
    // nicht aufloesen (Edge-Geraete stehen in keiner Sync-Allowlist), und eine
    // Liste waere eine unbegrenzt wachsende Nutzlast statt zweier Integer.
    return { online, total }
  } catch (err) {
    logger.warn({
      message: 'Geraetezaehlung fuer Heartbeat nicht ermittelbar — Heartbeat laeuft ohne',
      event: 'sync.heartbeat.device_counts_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
