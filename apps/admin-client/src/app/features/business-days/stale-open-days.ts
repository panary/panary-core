/** Felder, die die Verwaist-Erkennung braucht — Teilmenge des lokalen `BusinessDay`. */
export interface OpenDayCandidate {
  _id: string
  date: string
  status: string
  locationId: string | null
  openedAt: string
}

/**
 * Offene Tage, die es nicht mehr geben duerfte.
 *
 * Pro Filiale darf genau ein Tag offen sein (openDay-Guard). Mehrere offene
 * Tage derselben Filiale sind eine Anomalie — typisch nach abgebrochenem
 * Abschluss, Zeiger-Drift oder lokaler Auto-Rotation im Offline-Override.
 *
 * Echt ist je Filiale der Tag, auf den `locations.currentBusinessDay` zeigt
 * (`currentDayIds`). Zeigt kein Zeiger auf einen der offenen Tage, gilt der
 * juengste: erst nach `date`, bei gleichem Datum nach `openedAt` (core#737 —
 * vorher entschied dort die Zeilenreihenfolge der DB).
 *
 * BEWUSST nach locationId gruppiert: ein Tenant mit mehreren Filialen hat
 * legitim mehrere offene Tage gleichzeitig, und TENANT_OWNER/-MANAGER sehen
 * ueber multiTenancy alle Filialen. Ohne Gruppierung gaebe es Fehlalarme.
 */
export function findStaleOpenDayIds(
  days: readonly OpenDayCandidate[],
  currentDayIds: ReadonlySet<string> = new Set(),
): Set<string> {
  const byLocation = new Map<string, OpenDayCandidate[]>()
  for (const bd of days) {
    if (bd.status !== 'open') continue
    const key = bd.locationId ?? '__global__'
    byLocation.set(key, [...(byLocation.get(key) ?? []), bd])
  }

  const stale = new Set<string>()
  for (const open of byLocation.values()) {
    if (open.length < 2) continue
    const keep =
      open.find(bd => currentDayIds.has(bd._id)) ??
      // `date` ist YYYY-MM-DD, `openedAt` ISO 8601 → lexikografisch == chronologisch.
      open.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.openedAt > a.openedAt) ? b : a))
    for (const bd of open) if (bd._id !== keep._id) stale.add(bd._id)
  }
  return stale
}
