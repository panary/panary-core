/** Was die Meldungsebene vom Popover-API braucht — schmal, damit es ohne DOM prüfbar ist. */
export type TopLayerElement = {
  showPopover?: () => void
  hidePopover: () => void
  matches: (selector: string) => boolean
  style: { top: string }
}

type ToggleLike = { target: unknown; newState?: string }

export type ToggleTarget = {
  addEventListener: (type: 'toggle', listener: (event: ToggleLike) => void, capture: boolean) => void
  removeEventListener: (type: 'toggle', listener: (event: ToggleLike) => void, capture: boolean) => void
}

/**
 * Hält die Meldungsebene im Top-Layer (core#1060).
 *
 * Angular CDK rendert Dialoge und Sheets als Popover im Top-Layer des Browsers; dagegen hilft kein
 * `z-index`. Die Ebene ist deshalb selbst ein Popover. Im Top-Layer liegt oben, was zuletzt
 * geöffnet wurde: Öffnet ein Dialog, während Meldungen stehen, wird die Ebene neu geöffnet und liegt
 * wieder darüber. Ohne Popover-API (alte WebViews) bleibt sie, wie sie ist, im normalen Fluss.
 */
export function syncTopLayer(layer: TopLayerElement, visible: boolean, top: number): void {
  if (typeof layer.showPopover !== 'function') return
  const open = layer.matches(':popover-open')
  if (!visible) {
    if (open) layer.hidePopover()
    return
  }
  layer.style.top = `${top}px`
  if (!open) layer.showPopover()
}

/**
 * Holt die Ebene nach oben, sobald ein anderes Popover öffnet. `changed` läuft bei jedem fremden
 * Öffnen und Schließen — die Ebene richtet ihre Lage dann neu am offenen Dialog aus (core#1087).
 * Gibt die Abmeldung zurück.
 */
export function raiseAboveForeignPopovers(
  doc: ToggleTarget,
  layer: TopLayerElement,
  visible: () => boolean,
  top: () => number,
  changed?: () => void,
): () => void {
  const onToggle = (event: ToggleLike): void => {
    if (event.target === layer) return
    changed?.()
    if (event.newState !== 'open' || !visible()) return
    if (typeof layer.showPopover !== 'function') return
    if (layer.matches(':popover-open')) layer.hidePopover()
    syncTopLayer(layer, true, top())
  }
  // `toggle` blubbert nicht; im Capture-Durchlauf erreicht es das Dokument trotzdem.
  doc.addEventListener('toggle', onToggle, true)
  return () => doc.removeEventListener('toggle', onToggle, true)
}

/** Senkrechte Ausdehnung eines offenen modalen Dialogs in Fensterkoordinaten. */
export type DialogBounds = { top: number; bottom: number }

/** Wo die Ebene steht und wie viele Meldungen (die neuesten zuerst) sie zeigt. */
export type LayerPlacement = { top: number; count: number }

/** Abstand der Ebene zu Dialog und Fensterrand in px. */
const DIALOG_CLEARANCE = 8

/**
 * Lage der Meldungsebene neben einem offenen modalen Dialog (core#1087).
 *
 * Die Ebene liegt im Top-Layer über den Dialogen (core#1060), damit Meldungen aus einem Dialog sichtbar
 * bleiben. Ohne Rücksicht auf den Dialog verdeckte der Stapel dessen Kopf und Tasten — nach dem Abschicken
 * den Druckdialog. Deshalb: Oben an gewohnter Stelle, solange der Stapel über den Dialog passt; sonst direkt
 * darunter. Passt er nirgends ganz, zeigt die Ebene im größeren Streifen so viele der neuesten Meldungen,
 * wie hineinpassen — notfalls keine, bis der Dialog schließt. Die übrigen bleiben im Dienst stehen und laufen
 * weiter ab. Ohne Dialog ändert sich nichts.
 *
 * `heights` sind die Höhen der Meldungen in Anzeigereihenfolge (neueste zuerst), `gap` der Abstand dazwischen.
 */
export function placeBesideDialog(input: {
  anchorTop: number
  viewportHeight: number
  dialog: DialogBounds | null
  heights: readonly number[]
  gap: number
}): LayerPlacement {
  const { anchorTop, viewportHeight, dialog, heights, gap } = input
  if (!dialog) return { top: anchorTop, count: heights.length }

  const fitting = (space: number): number => {
    let used = 0
    for (let i = 0; i < heights.length; i++) {
      used += heights[i] + (i > 0 ? gap : 0)
      if (used > space) return i
    }
    return heights.length
  }
  const belowTop = dialog.bottom + DIALOG_CLEARANCE
  const above = fitting(dialog.top - DIALOG_CLEARANCE - anchorTop)
  const below = fitting(viewportHeight - DIALOG_CLEARANCE - belowTop)

  if (above === heights.length) return { top: anchorTop, count: above }
  if (below === heights.length) return { top: belowTop, count: below }
  return above >= below ? { top: anchorTop, count: above } : { top: belowTop, count: below }
}
