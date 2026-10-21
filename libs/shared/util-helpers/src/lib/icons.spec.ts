import { ICON_PATHS, iconPath } from './icons.generated'

describe('POS-Icon-Registry', () => {
  it('enthält die Icons, die der POS an zentralen Stellen braucht', () => {
    for (const name of ['x', 'check', 'plus', 'minus', 'printer', 'arrows-clockwise']) {
      expect(ICON_PATHS).toHaveProperty(name)
    }
  })

  it('führt je Icon genau einen nichtleeren Pfad, der mit einem Move-Befehl beginnt', () => {
    const invalid = (Object.entries(ICON_PATHS) as [string, string][])
      .filter(([, d]) => !/^M[-\d.,\s]/.test(d))
      .map(([name]) => name)
    expect(invalid).toEqual([])
  })

  it('iconPath liefert den Pfad der Registry', () => {
    expect(iconPath('x')).toBe(ICON_PATHS.x)
  })
})
