// Der Start-Bootstrap in `main.ts` legt bei leerer `locations`-Tabelle einen lokalen
// Standort mit frisch erzeugter tenantId an — gedacht fuer die Ersteinrichtung ohne Cloud.
// Ein gepairter Edge bekommt seinen Standort dagegen aus der Cloud. Lief der Bootstrap dort
// (Tabelle nach „Alles aus der Cloud uebernehmen" leer), entstand eine Zeile unter einem
// erfundenen Mandanten, die der Repair-Hook nur auf die Cloud-LocationId umstempelte: Der
// Pull patchte sie, Admin und Kasse sahen sie wegen des Mandantenfilters nie (#677).

const PAIRED_STATES = new Set(['pairing', 'connected'])

/** `true`, solange ein Pairing laeuft oder steht — dann gehoert der Standort der Cloud. */
export const isCloudPairedConnection = (row: { pairingStatus?: string | null } | null | undefined): boolean =>
  typeof row?.pairingStatus === 'string' && PAIRED_STATES.has(row.pairingStatus)

export type LocalLocationBootstrap = 'create' | 'skip-paired' | 'exists'

/** Entscheidung des Start-Bootstraps: lokal anlegen nur ohne Location UND ohne Pairing. */
export const decideLocalLocationBootstrap = (
  locationCount: number,
  connection: { pairingStatus?: string | null } | null | undefined,
): LocalLocationBootstrap => {
  if (locationCount > 0) return 'exists'
  return isCloudPairedConnection(connection) ? 'skip-paired' : 'create'
}
