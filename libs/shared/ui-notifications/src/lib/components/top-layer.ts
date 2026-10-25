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

/** Holt die Ebene nach oben, sobald ein anderes Popover öffnet. Gibt die Abmeldung zurück. */
export function raiseAboveForeignPopovers(
  doc: ToggleTarget,
  layer: TopLayerElement,
  visible: () => boolean,
  top: () => number,
): () => void {
  const onToggle = (event: ToggleLike): void => {
    if (event.target === layer || event.newState !== 'open' || !visible()) return
    if (typeof layer.showPopover !== 'function') return
    if (layer.matches(':popover-open')) layer.hidePopover()
    syncTopLayer(layer, true, top())
  }
  // `toggle` blubbert nicht; im Capture-Durchlauf erreicht es das Dokument trotzdem.
  doc.addEventListener('toggle', onToggle, true)
  return () => doc.removeEventListener('toggle', onToggle, true)
}
