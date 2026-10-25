// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  MODAL_DIALOG_SELECTOR,
  openModalBounds,
  placeBesideDialog,
  raiseAboveForeignPopovers,
  syncTopLayer,
  type ToggleTarget,
  type TopLayerElement,
} from './top-layer'

/** Popover-Attrappe: zeichnet Öffnen/Schließen in Reihenfolge auf. */
function fakeLayer(supported = true) {
  const calls: string[] = []
  let open = false
  const layer: TopLayerElement = {
    style: { top: '' },
    matches: selector => selector === ':popover-open' && open,
    hidePopover: () => {
      calls.push('hide')
      open = false
    },
    ...(supported
      ? {
          showPopover: () => {
            calls.push('show')
            open = true
          },
        }
      : {}),
  }
  return { layer, calls, isOpen: () => open }
}

function fakeDocument() {
  const listeners: Array<(event: { target: unknown; newState?: string }) => void> = []
  const doc: ToggleTarget = {
    addEventListener: (_type, listener, capture) => {
      expect(capture).toBe(true)
      listeners.push(listener)
    },
    removeEventListener: (_type, listener) => {
      listeners.splice(listeners.indexOf(listener), 1)
    },
  }
  const toggle = (target: unknown, newState: string) => listeners.forEach(l => l({ target, newState }))
  return { doc, toggle, listeners }
}

describe('syncTopLayer (core#1060)', () => {
  it('öffnet die Ebene mit Meldungen und setzt die Oberkante', () => {
    const { layer, calls } = fakeLayer()
    syncTopLayer(layer, true, 44)

    expect(calls).toEqual(['show'])
    expect(layer.style.top).toBe('44px')
  })

  it('öffnet eine offene Ebene nicht erneut — sonst spielte jede neue Meldung alle Einblendungen neu', () => {
    const { layer, calls } = fakeLayer()
    syncTopLayer(layer, true, 8)
    syncTopLayer(layer, true, 8)

    expect(calls).toEqual(['show'])
  })

  it('schließt die Ebene ohne Meldungen', () => {
    const { layer, calls, isOpen } = fakeLayer()
    syncTopLayer(layer, true, 8)
    syncTopLayer(layer, false, 8)

    expect(calls).toEqual(['show', 'hide'])
    expect(isOpen()).toBe(false)
  })

  it('ohne Popover-API bleibt die Ebene unangetastet', () => {
    const { layer, calls } = fakeLayer(false)
    syncTopLayer(layer, true, 8)

    expect(calls).toEqual([])
    expect(layer.style.top).toBe('')
  })
})

describe('raiseAboveForeignPopovers (core#1060)', () => {
  it('holt die Ebene über einen später geöffneten Dialog', () => {
    const { layer, calls } = fakeLayer()
    const { doc, toggle } = fakeDocument()
    syncTopLayer(layer, true, 8)
    raiseAboveForeignPopovers(
      doc,
      layer,
      () => true,
      () => 8,
    )

    toggle({ dialog: true }, 'open')

    expect(calls).toEqual(['show', 'hide', 'show'])
  })

  it('reagiert weder auf die eigene Ebene noch auf schließende Overlays noch ohne Meldungen', () => {
    const { layer, calls } = fakeLayer()
    const { doc, toggle } = fakeDocument()
    let visible = true
    raiseAboveForeignPopovers(
      doc,
      layer,
      () => visible,
      () => 8,
    )

    toggle(layer, 'open')
    toggle({ dialog: true }, 'closed')
    visible = false
    toggle({ dialog: true }, 'open')

    expect(calls).toEqual([])
  })

  it('meldet sich wieder ab', () => {
    const { layer } = fakeLayer()
    const { doc, listeners } = fakeDocument()
    const stop = raiseAboveForeignPopovers(
      doc,
      layer,
      () => true,
      () => 8,
    )

    stop()

    expect(listeners).toHaveLength(0)
  })
})

describe('placeBesideDialog (core#1087)', () => {
  const base = { anchorTop: 52, viewportHeight: 768, gap: 6 }

  it('ohne Dialog: gewohnte Stelle, alle Meldungen', () => {
    expect(placeBesideDialog({ ...base, dialog: null, heights: [56, 56, 56] })).toEqual({ top: 52, count: 3 })
  })

  it('bleibt oben, solange der Stapel über den Dialog passt', () => {
    // Druckdialog mittig: Oberkante 200 px — Platz für zwei Meldungen (56 + 6 + 56 = 118 ≤ 140).
    expect(placeBesideDialog({ ...base, dialog: { top: 200, bottom: 560 }, heights: [56, 56] })).toEqual({
      top: 52,
      count: 2,
    })
  })

  it('weicht unter den Dialog aus, wenn oben kein Platz ist', () => {
    expect(placeBesideDialog({ ...base, dialog: { top: 90, bottom: 500 }, heights: [56, 56] })).toEqual({
      top: 508,
      count: 2,
    })
  })

  it('zeigt im größeren Streifen nur so viele der neuesten, wie hineinpassen', () => {
    // Oben 130 px (zwei Meldungen), unten 760 − 698 = 62 px (eine): oben gewinnt.
    expect(placeBesideDialog({ ...base, dialog: { top: 190, bottom: 690 }, heights: [56, 56, 56] })).toEqual({
      top: 52,
      count: 2,
    })
  })

  it('zeigt keine Meldung, solange ein fensterhoher Dialog offen ist', () => {
    expect(placeBesideDialog({ ...base, dialog: { top: 40, bottom: 760 }, heights: [56] })).toEqual({
      top: 52,
      count: 0,
    })
  })
})

describe('raiseAboveForeignPopovers — Dialogwechsel (core#1087)', () => {
  it('meldet jedes fremde Öffnen und Schließen, auch ohne Meldungen, nie die eigene Ebene', () => {
    const { layer } = fakeLayer()
    const { doc, toggle } = fakeDocument()
    const changes: string[] = []
    raiseAboveForeignPopovers(
      doc,
      layer,
      () => false,
      () => 8,
      () => changes.push('x'),
    )

    toggle(layer, 'open')
    toggle({ dialog: true }, 'open')
    toggle({ dialog: true }, 'closed')

    expect(changes).toHaveLength(2)
  })
})

describe('openModalBounds (core#1087)', () => {
  const candidate = (rect: { top: number; bottom: number }, host: unknown = null) => ({
    closest: () => host as never,
    getBoundingClientRect: () => ({ ...rect, width: 400, height: rect.bottom - rect.top }),
  })

  it('nimmt den obersten (zuletzt geöffneten) offenen Dialog', () => {
    const open = { showPopover: () => undefined, matches: () => true }
    expect(
      openModalBounds([candidate({ top: 10, bottom: 20 }, open), candidate({ top: 200, bottom: 500 }, open)]),
    ).toEqual({ top: 200, bottom: 500 })
  })

  it('überspringt einen Dialog in einem geschlossenen Popover', () => {
    const closed = { showPopover: () => undefined, matches: () => false }
    expect(openModalBounds([candidate({ top: 200, bottom: 500 }, closed)])).toBeNull()
  })

  it('fragt ohne Popover-API kein :popover-open ab — das würfe in alten WebViews', () => {
    const legacy = {
      matches: () => {
        throw new SyntaxError(':popover-open')
      },
    }
    expect(openModalBounds([candidate({ top: 200, bottom: 500 }, legacy)])).toEqual({ top: 200, bottom: 500 })
  })

  it('ein unsichtbarer Dialog zählt nicht', () => {
    expect(
      openModalBounds([
        { closest: () => null, getBoundingClientRect: () => ({ top: 0, bottom: 0, width: 0, height: 0 }) },
      ]),
    ).toBeNull()
  })
})

describe('MODAL_DIALOG_SELECTOR (core#1094)', () => {
  // Echter Selektor-Abgleich im DOM (jsdom-Umgebung dieser Datei), nicht ein Stringvergleich.
  const matches = (html: string) => {
    document.body.innerHTML = html
    return document.querySelectorAll(MODAL_DIALOG_SELECTOR).length
  }

  it('erkennt einen Material-Dialog, obwohl er aria-modal="false" trägt', () => {
    expect(
      matches('<mat-dialog-container class="mat-mdc-dialog-container cdk-dialog-container" aria-modal="false">'),
    ).toBe(1)
  })

  it('erkennt einen CDK-Dialog und jedes Element mit aria-modal="true"', () => {
    expect(matches('<cdk-dialog-container class="cdk-dialog-container"></cdk-dialog-container>')).toBe(1)
    expect(matches('<div role="dialog" aria-modal="true"></div>')).toBe(1)
  })

  it('übersieht die Kassen-Sheets und die Auto-Logout-Vorwarnung', () => {
    expect(
      matches('<div role="dialog" class="kasse__sheet"></div><div popover="manual" role="alertdialog"></div>'),
    ).toBe(0)
  })
})
