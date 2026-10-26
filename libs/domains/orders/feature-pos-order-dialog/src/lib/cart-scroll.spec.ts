import { describe, expect, it, vi } from 'vitest'

import {
  CART_USER_SCROLL_HOLD_MS,
  cartPingClass,
  nextCartPing,
  revealCartLine,
  revealCartSelection,
  watchCartUserScroll,
} from './cart-scroll'

describe('Warenkorb — markierte Zeile in den Sichtbereich (core#1021)', () => {
  it('scrollt die Steuerleiste nur so weit wie nötig und sanft', () => {
    const scrollIntoView = vi.fn()
    revealCartSelection({ scrollIntoView })
    expect(scrollIntoView.mock.calls).toEqual([[{ block: 'nearest', behavior: 'smooth' }]])
  })

  it('tut nichts, solange keine Zeile markiert ist', () => {
    expect(() => revealCartSelection(undefined)).not.toThrow()
  })
})

/** Eine Liste mit einer Zeile je ID; `querySelector` antwortet nur auf das Attribut `data-cart-line`. */
function cartList(ids: string[]) {
  const lines = new Map(ids.map(id => [id, { scrollIntoView: vi.fn() }]))
  const queries: string[] = []
  return {
    lines,
    queries,
    list: {
      querySelector: (selector: string) => {
        queries.push(selector)
        const id = selector.match(/^\[data-cart-line="([^"]+)"\]$/)?.[1]
        return (id ? lines.get(id) : undefined) ?? null
      },
    },
  }
}

describe('Warenkorb — beim Hinzufügen mitscrollen (core#1116)', () => {
  it('scrollt zur betroffenen Zeile, mit derselben Bewegung wie die Steuerleiste', () => {
    const { list, lines } = cartList(['a', 'b'])
    revealCartLine(list, { lineId: 'b', kind: 'new', seq: 1 }, 0, 10_000)
    expect(lines.get('b')?.scrollIntoView.mock.calls).toEqual([[{ block: 'nearest', behavior: 'smooth' }]])
    expect(lines.get('a')?.scrollIntoView).not.toHaveBeenCalled()
  })

  it('springt nicht, solange die Bedienung vor weniger als 1,5 s selbst gewischt hat', () => {
    expect(CART_USER_SCROLL_HOLD_MS).toBe(1500)
    const { list, lines } = cartList(['a'])
    revealCartLine(list, { lineId: 'a', kind: 'more', seq: 1 }, 10_000, 10_000 + CART_USER_SCROLL_HOLD_MS - 1)
    expect(lines.get('a')?.scrollIntoView).not.toHaveBeenCalled()

    revealCartLine(list, { lineId: 'a', kind: 'more', seq: 1 }, 10_000, 10_000 + CART_USER_SCROLL_HOLD_MS)
    expect(lines.get('a')?.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('tut nichts ohne Hinzufügen, ohne Liste oder wenn die Zeile nicht (mehr) da ist', () => {
    const { list, queries } = cartList(['a'])
    expect(() => revealCartLine(list, null, 0, 10_000)).not.toThrow()
    expect(queries).toEqual([])
    expect(() => revealCartLine(undefined, { lineId: 'a', kind: 'new', seq: 1 }, 0, 10_000)).not.toThrow()
    expect(() => revealCartLine(list, { lineId: 'weg', kind: 'new', seq: 1 }, 0, 10_000)).not.toThrow()
  })
})

describe('Warenkorb — Hervorhebung der hinzugefügten Zeile (core#1116)', () => {
  it('zählt jedes Hinzufügen weiter, auch auf derselben Zeile', () => {
    const first = nextCartPing(null, 'a', 'new')
    const second = nextCartPing(first, 'a', 'more')
    expect(first).toEqual({ lineId: 'a', kind: 'new', seq: 1 })
    expect(second).toEqual({ lineId: 'a', kind: 'more', seq: 2 })
    expect(nextCartPing(second, 'b', 'new')).toEqual({ lineId: 'b', kind: 'new', seq: 3 })
  })

  it('wechselt bei jedem Tippen den Klassennamen, damit die Animation neu startet statt zu stapeln', () => {
    const first = nextCartPing(null, 'a', 'more')
    const second = nextCartPing(first, 'a', 'more')
    expect(cartPingClass(first, 'a')).toBe('kasse-line-more-1')
    expect(cartPingClass(second, 'a')).toBe('kasse-line-more-0')
    expect(cartPingClass(nextCartPing(second, 'a', 'new'), 'a')).toBe('kasse-line-new-1')
  })

  it('hebt nur die betroffene Zeile hervor', () => {
    const ping = nextCartPing(null, 'a', 'new')
    expect(cartPingClass(ping, 'b')).toBeNull()
    expect(cartPingClass(null, 'a')).toBeNull()
  })
})

describe('Warenkorb — eigenes Wischen erkennen (core#1116)', () => {
  it('hört passiv auf Wischen und Mausrad und meldet sich beim Aufräumen wieder ab', () => {
    const added: Array<[string, unknown, unknown]> = []
    const removed: Array<[string, unknown]> = []
    const list = {
      addEventListener: (type: string, listener: unknown, options: unknown) => added.push([type, listener, options]),
      removeEventListener: (type: string, listener: unknown) => removed.push([type, listener]),
    }
    const onScroll = vi.fn()

    const stop = watchCartUserScroll(list, onScroll)
    expect(added.map(([type, , options]) => [type, options])).toEqual([
      ['touchmove', { passive: true }],
      ['wheel', { passive: true }],
    ])
    ;(added[0][1] as () => void)()
    expect(onScroll).toHaveBeenCalledTimes(1)

    stop()
    expect(removed).toEqual(added.map(([type, listener]) => [type, listener]))
  })

  it('tut ohne Liste nichts', () => {
    expect(() => watchCartUserScroll(undefined, vi.fn())()).not.toThrow()
  })
})
