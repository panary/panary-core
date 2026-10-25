/**
 * Warenkorb: Die Steuerleiste der markierten Zeile in den Sichtbereich holen (core#1021).
 *
 * Die Leiste öffnet sich unter der angetippten Zeile. Bei einer der unteren Zeilen lag sie halb unter dem Rand der
 * Liste, und man musste von Hand nachscrollen (Sunmi-Test pos-v26.10.29). `block: 'nearest'` scrollt nur, wenn etwas
 * fehlt, und nur so weit wie nötig — die Zeile darüber war beim Antippen sichtbar und bleibt es.
 */
export function revealCartSelection(toolbar: Pick<HTMLElement, 'scrollIntoView'> | undefined): void {
  toolbar?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
