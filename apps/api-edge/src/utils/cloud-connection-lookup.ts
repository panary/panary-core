// Einheitliche Auswahl der massgeblichen `cloud-connection`-Zeile.
//
// **Warum das eine gemeinsame Stelle braucht:** Die Tabelle kann mehr als eine
// Zeile enthalten — Altlasten aus abgebrochenen Pairings werden nirgends
// aufgeraeumt, und es gibt keinen Unique-Constraint. Ein blindes
// `find({ $limit: 1 })` liefert dann eine beliebige davon.
//
// Die Business-Pfade (`cloudManaged()`-Hook, `isLocalRotationAllowed`,
// `getConnectedCloudConnection`) filtern deshalb seit jeher auf
// `pairingStatus: CONNECTED`. `/health` tat das nicht — solange der Wert rein
// informativ war, fiel das nicht auf. Seit `systemMode` und der Notfall-Modus
// daraus abgeleitet werden, entscheidet diese Zeile aber darueber, ob der
// Admin-Client seine Formulare sperrt. Eine Altlast-Zeile liess dort alle
// Standort-Seiten editierbar erscheinen, waehrend das Backend jeden Save mit
// 403 ablehnte.

import { PairingStatus, type CloudConnection } from '@panary/cloud-connection/domain'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Feathers Application hat generischen Typ Application<any, any>
type FeathersApp = any

const findOne = async (
  app: FeathersApp,
  query: Record<string, unknown>,
): Promise<CloudConnection | null> => {
  const result = await app.service('cloud-connection').find({
    provider: undefined,
    paginate: false,
    query,
  })
  const list = Array.isArray(result) ? result : []
  return (list[0] as CloudConnection | undefined) ?? null
}

/**
 * Die aktive (CONNECTED) Verbindung — oder `null`. Identische Semantik wie im
 * `cloudManaged()`-Hook: nur ein aktives Pairing gibt der Cloud die Hoheit.
 */
export const findConnectedCloudConnection = async (
  app: FeathersApp,
): Promise<CloudConnection | null> => {
  try {
    return await findOne(app, { pairingStatus: PairingStatus.CONNECTED, $limit: 1 })
  } catch {
    // Fail-open: beim allerersten Boot ist der Service noch nicht registriert.
    return null
  }
}

/**
 * Fuer Reporting-Zwecke (`/health`, mDNS): bevorzugt die CONNECTED-Verbindung,
 * faellt sonst auf eine beliebige zurueck.
 *
 * Der Fallback ist bewusst: ein Edge, dessen Token die Cloud abgelehnt hat,
 * steht auf `disconnected` und hat gar keine CONNECTED-Zeile — er muss seinen
 * Re-Pairing-Bedarf trotzdem melden koennen. Nur die *Reihenfolge* ist neu:
 * existiert eine aktive Verbindung, gewinnt sie immer.
 */
export const findReportableCloudConnection = async (
  app: FeathersApp,
): Promise<CloudConnection | null> => {
  try {
    return (await findOne(app, { pairingStatus: PairingStatus.CONNECTED, $limit: 1 })) ??
      (await findOne(app, { $limit: 1 }))
  } catch {
    return null
  }
}
