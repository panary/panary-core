// Herleitung des effektiven System-Modus (Tier-Modell) fuer Reporting-Zwecke:
// `/health` und mDNS-TXT. Frueher kam der Wert direkt aus `config.system.mode`,
// das in `default.json` fest auf `"standalone"` steht und kein ENV-Mapping
// hatte — dadurch meldete auch ein gepairter Edge dauerhaft `standalone` und
// die gesamte Tier-3-UI (Cloud-Banner, Offline-Modus-Aktion, Re-Pairing-Warnung)
// blieb unerreichbar.
//
// **Nicht fuer Business-Logik verwenden.** Ob lokale Schreibzugriffe oder eine
// Geschaeftstag-Rotation erlaubt sind, entscheidet ausschliesslich der
// Pairing-Zustand (`isLocalRotationAllowed`, `cloudManaged()`-Hook). Dieser
// Modus ist eine Beschreibung nach aussen, keine Berechtigung.

import { PairingStatus } from '@panary/cloud-connection/domain'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Feathers Application hat generischen Typ Application<any, any>
type FeathersApp = any

export type SystemMode = 'cloud' | 'standalone' | 'connected'

/**
 * Leitet den Tier-Modus aus statischer Config plus Pairing-Zustand ab.
 *
 * - `'cloud'` (Tier 1) gewinnt immer aus der Config: dort gibt es gar keinen
 *   Edge, also auch kein Pairing, das etwas aussagen koennte.
 * - `'connected'` (Tier 3), sobald eine Cloud-Connection auf CONNECTED steht.
 * - sonst `'standalone'` (Tier 2).
 *
 * Pure Funktion — bewusst ohne App-Zugriff, damit die Matrix ohne DB-Zustand
 * testbar bleibt (gleiches Muster wie `evaluateOutboxGuard` in business-days).
 */
export const systemModeFromPairing = (
  configuredMode: string | undefined,
  pairingStatus: string | undefined,
): SystemMode => {
  if (configuredMode === 'cloud') return 'cloud'
  return pairingStatus === PairingStatus.CONNECTED ? 'connected' : 'standalone'
}

/**
 * Variante fuer Aufrufer ohne bereits geladene `cloud-connection` (Boot-Pfad,
 * mDNS). Fail-open auf `'standalone'` — ein Reporting-Wert darf den Start nie
 * blockieren.
 */
export const resolveSystemMode = async (app: FeathersApp): Promise<SystemMode> => {
  const configuredMode = app.get('system')?.mode
  if (configuredMode === 'cloud') return 'cloud'
  try {
    const result = await app.service('cloud-connection').find({
      provider: undefined,
      paginate: false,
      query: { $limit: 1 },
    })
    const list = Array.isArray(result) ? result : []
    return systemModeFromPairing(configuredMode, list[0]?.pairingStatus)
  } catch {
    return 'standalone'
  }
}
