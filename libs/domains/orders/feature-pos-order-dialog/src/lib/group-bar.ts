/**
 * Aufteilung der Produktgruppen auf die Gruppenleiste der Kasse (core#829, Konzept §4).
 *
 * Die Leiste ist ein Raster `repeat(auto-fill, minmax(9rem, 1fr))` über die volle Breite und
 * zeigt höchstens zwei Zeilen. Passen nicht alle Gruppen hinein, wird das letzte Feld zu
 * „Weitere (n)" und öffnet alle Gruppen — gewischt wird nie. Wie viele Felder je Zeile passen,
 * rechnet hier dieselbe Formel wie `auto-fill`, damit Raster und Aufteilung nie auseinanderlaufen.
 */

/** Mindestbreite eines Gruppenfelds in rem — muss zu `minmax(9rem, 1fr)` im Template passen. */
export const GROUP_MIN_WIDTH_REM = 9
/** Abstand zwischen den Feldern in rem — `gap-2` im Template. */
export const GROUP_GAP_REM = 0.5
/** Mehr Zeilen nimmt die Leiste nicht ein, sonst schrumpft das Raster darunter (Konzept §4). */
export const GROUP_MAX_ROWS = 2

export interface GroupBarSplit<TGroup> {
  visible: TGroup[]
  overflow: TGroup[]
}

/** Felder je Zeile bei `auto-fill`: so viele Mindestbreiten samt Abstand, wie hineinpassen, mindestens eins. */
export function groupColumns(containerWidthPx: number, remPx: number): number {
  const min = GROUP_MIN_WIDTH_REM * remPx
  const gap = GROUP_GAP_REM * remPx
  return Math.max(1, Math.floor((containerWidthPx + gap) / (min + gap)))
}

/**
 * Teilt die Gruppen auf: Passen alle in zwei Zeilen, sind alle sichtbar. Sonst bleibt das letzte
 * Feld für „Weitere" frei, und der Rest wandert in die Übersicht aller Gruppen.
 */
export function splitGroupBar<TGroup>(
  groups: readonly TGroup[],
  containerWidthPx: number,
  remPx: number,
): GroupBarSplit<TGroup> {
  const capacity = groupColumns(containerWidthPx, remPx) * GROUP_MAX_ROWS
  if (groups.length <= capacity) return { visible: [...groups], overflow: [] }
  const shown = Math.max(0, capacity - 1)
  return { visible: groups.slice(0, shown), overflow: groups.slice(shown) }
}
