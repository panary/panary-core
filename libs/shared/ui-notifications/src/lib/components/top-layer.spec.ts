import { describe, expect, it } from 'vitest'

import { raiseAboveForeignPopovers, syncTopLayer, type ToggleTarget, type TopLayerElement } from './top-layer'

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
