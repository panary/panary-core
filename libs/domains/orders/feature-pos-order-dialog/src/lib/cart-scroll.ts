/** Eine Bewegung für alles, was der Warenkorb von selbst in den Sichtbereich holt (core#1021, core#1116). */
const REVEAL: ScrollIntoViewOptions = { block: 'nearest', behavior: 'smooth' }

/**
 * Warenkorb: Die Steuerleiste der markierten Zeile in den Sichtbereich holen (core#1021).
 *
 * Die Leiste öffnet sich unter der angetippten Zeile. Bei einer der unteren Zeilen lag sie halb unter dem Rand der
 * Liste, und man musste von Hand nachscrollen (Sunmi-Test pos-v26.10.29). `block: 'nearest'` scrollt nur, wenn etwas
 * fehlt, und nur so weit wie nötig — die Zeile darüber war beim Antippen sichtbar und bleibt es.
 */
export function revealCartSelection(toolbar: Pick<HTMLElement, 'scrollIntoView'> | undefined): void {
  toolbar?.scrollIntoView(REVEAL)
}

/** So lange nach dem letzten eigenen Wischen springt die Liste beim Hinzufügen nicht (core#1116). */
export const CART_USER_SCROLL_HOLD_MS = 1500

/**
 * Die zuletzt hinzugefügte (`new`) oder hochgezählte (`more`) Zeile. `seq` zählt jedes Hinzufügen, auch auf
 * derselben Zeile; daran hängt der Neustart der Hervorhebung.
 */
export interface CartPing {
  lineId: string
  kind: 'new' | 'more'
  seq: number
}

export function nextCartPing(prev: CartPing | null, lineId: string, kind: CartPing['kind']): CartPing {
  return { lineId, kind, seq: (prev?.seq ?? 0) + 1 }
}

/**
 * Klasse der Hervorhebung für eine Zeile, sonst `null`.
 *
 * Eine CSS-Animation startet nur neu, wenn sich ihr Name ändert. Bliebe die Klasse beim zweiten Tippen gleich, liefe
 * die erste einfach weiter. Deshalb wechselt die Endung mit jedem Hinzufügen zwischen `-0` und `-1`, und die SCSS
 * legt jede Animation doppelt an: Schnelles Mehrfachtippen beginnt von vorn, statt sich zu stapeln.
 */
export function cartPingClass(ping: CartPing | null, lineId: string): string | null {
  return ping?.lineId === lineId ? `kasse-line-${ping.kind}-${ping.seq % 2}` : null
}

/**
 * Warenkorb: Nach dem Hinzufügen zur betroffenen Zeile scrollen (core#1116), mit derselben Bewegung wie die
 * Steuerleiste. Hat die Bedienung gerade selbst gewischt, bleibt die Liste stehen: Sie sucht dort etwas, und ein
 * Sprung nähme ihr die Stelle weg.
 */
export function revealCartLine(
  list: Pick<HTMLElement, 'querySelector'> | undefined,
  ping: CartPing | null,
  userScrollAt: number,
  now: number,
): void {
  if (!ping || !list || now - userScrollAt < CART_USER_SCROLL_HOLD_MS) return
  list.querySelector<HTMLElement>(`[data-cart-line="${ping.lineId}"]`)?.scrollIntoView(REVEAL)
}

/**
 * Meldet eigenes Wischen in der Liste. Das `scroll`-Ereignis taugt dafür nicht, es feuert auch beim Scrollen von
 * selbst. Passiv und außerhalb der Change Detection: `touchmove` kommt beim Wischen im Bildtakt.
 */
export function watchCartUserScroll(
  list: Pick<HTMLElement, 'addEventListener' | 'removeEventListener'> | undefined,
  onScroll: () => void,
): () => void {
  if (!list) return () => undefined
  const types = ['touchmove', 'wheel'] as const
  for (const type of types) list.addEventListener(type, onScroll, { passive: true })
  return () => {
    for (const type of types) list.removeEventListener(type, onScroll)
  }
}
