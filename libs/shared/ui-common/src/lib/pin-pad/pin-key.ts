/** Aktion, die eine Taste im PIN-Feld ausloest. Esc gehoert bewusst nicht dazu — er bleibt beim Host. */
export type PinKeyAction = { type: 'digit'; digit: string } | { type: 'backspace' }

/**
 * Ordnet einen Tastendruck einer PIN-Aktion zu: nur Ziffern 0-9 sowie Backspace/Delete.
 *
 * Tasten mit Strg/Cmd/Alt (Browser- und Systemkuerzel) und das Dauerfeuer einer gehaltenen
 * Ziffer ergeben keine Aktion. Eine gehaltene Taste soll keine halbe PIN eintippen.
 */
export function pinKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>
): PinKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key === 'Backspace' || event.key === 'Delete') return { type: 'backspace' }
  if (!event.repeat && /^[0-9]$/.test(event.key)) return { type: 'digit', digit: event.key }
  return null
}
