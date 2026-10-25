/** Anzahl der Monogramm-Farben; die Token `--mono-1` … `--mono-8` stehen in `@panary/design-tokens`. */
export const MONOGRAM_COLOR_COUNT = 8

/**
 * Farbplatz 1…8 einer Person. Nur aus der ID abgeleitet (FNV-1a), damit dieselbe Person in der
 * Mitarbeiterwahl, im PIN-Schritt, in der Rail und im Avatar-Menü dieselbe Farbe trägt —
 * unabhängig von Sortierung, Listenposition und Gerät.
 */
export function monogramColorIndex(userId: string | undefined | null): number {
  let hash = 0x811c9dc5
  for (const ch of userId ?? '') {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % MONOGRAM_COLOR_COUNT) + 1
}

/** Inline-Stil des Monogramm-Kreises: Hintergrund und Initialen-Farbe aus den Design-Tokens. */
export function monogramStyle(userId: string | undefined | null): Record<string, string> {
  return { 'background-color': `var(--mono-${monogramColorIndex(userId)})`, color: 'var(--mono-ink)' }
}
