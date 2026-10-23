/**
 * Aufteilung der Produktgruppen auf die Gruppenleiste der Kasse (core#908, ersetzt die Zwei-Zeilen-Leiste aus core#829).
 *
 * Die Leiste ist **eine** Zeile. Jede Gruppe ist so breit wie ihr Name (mit Farbpunkt), passen nicht alle hinein,
 * steht am Ende der Burger-Button mit dem Rest — wie vor core#829, nur mit gemessenen statt geschätzten Breiten.
 * Zwei Zeilen kosteten auf 1366×768 eine Rasterzeile, und die breiten Felder brachen lange Namen um (MacBook-Test
 * von pos-v26.10.25). Gewischt wird nie.
 */

/** Abstand zwischen den Feldern in rem — `gap-2` im Template. */
export const GROUP_GAP_REM = 0.5
/** Breite des Burger-Buttons in rem — `w-12` im Template. */
export const GROUP_BURGER_WIDTH_REM = 3

export interface GroupBarSplit<TGroup> {
  visible: TGroup[]
  overflow: TGroup[]
}

/**
 * Wie viele Gruppen der Reihe nach in die Zeile passen. Passen alle, braucht es keinen Burger; sonst wird sein Platz
 * samt Abstand freigehalten. Die Reihenfolge bleibt: Eine schmale Gruppe weiter hinten rückt nicht in eine Lücke vor,
 * sonst stünde die Leiste je nach Fensterbreite anders sortiert.
 */
export function fittingGroupCount(chipWidthsPx: readonly number[], containerWidthPx: number, remPx: number): number {
  const gap = GROUP_GAP_REM * remPx
  const total = chipWidthsPx.reduce((sum, width) => sum + width, 0) + Math.max(0, chipWidthsPx.length - 1) * gap
  if (total <= containerWidthPx) return chipWidthsPx.length

  const available = containerWidthPx - GROUP_BURGER_WIDTH_REM * remPx - gap
  let used = 0
  let count = 0
  for (const width of chipWidthsPx) {
    used += (count > 0 ? gap : 0) + width
    if (used > available) break
    count++
  }
  return count
}

/** Teilt die Gruppen nach `fittingGroupCount` auf; keine geht verloren, keine doppelt. */
export function splitGroupBar<TGroup>(
  groups: readonly TGroup[],
  chipWidthsPx: readonly number[],
  containerWidthPx: number,
  remPx: number,
): GroupBarSplit<TGroup> {
  const shown = fittingGroupCount(chipWidthsPx, containerWidthPx, remPx)
  return { visible: groups.slice(0, shown), overflow: groups.slice(shown) }
}
