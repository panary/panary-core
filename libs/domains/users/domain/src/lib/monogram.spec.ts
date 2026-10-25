import { MONOGRAM_COLOR_COUNT, monogramColorIndex, monogramStyle } from './monogram'

describe('monogram', () => {
  it('gleiche ID ergibt immer dieselbe Farbe', () => {
    const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
    expect(monogramColorIndex(id)).toBe(monogramColorIndex(id))
    expect(monogramStyle(id)).toEqual(monogramStyle(id))
  })

  it('liegt immer im Palettenbereich, auch ohne ID', () => {
    for (const id of ['', undefined, null, 'a', 'zz', '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b']) {
      const index = monogramColorIndex(id)
      expect(index).toBeGreaterThanOrEqual(1)
      expect(index).toBeLessThanOrEqual(MONOGRAM_COLOR_COUNT)
    }
  })

  it('verteilt viele IDs über die ganze Palette', () => {
    const used = new Set(Array.from({ length: 200 }, (_, i) => monogramColorIndex(`user-${i}`)))
    expect(used.size).toBe(MONOGRAM_COLOR_COUNT)
  })

  it('Stil verweist auf Token', () => {
    expect(monogramStyle('abc')).toEqual({
      'background-color': `var(--mono-${monogramColorIndex('abc')})`,
      color: 'var(--mono-ink)',
    })
  })
})
