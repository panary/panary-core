import { describe, expect, it, vi } from 'vitest'

import { revealCartSelection } from './cart-scroll'

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
