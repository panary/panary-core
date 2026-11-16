import { objectHash } from './dirty-check'

describe('objectHash', () => {
  const menu = () => ({
    name: 'Menü',
    price: 5,
    og: [{ id: 'og-1', name: 'Bleche', minSelections: 1, options: [{ productId: 'cola', priceAdjustment: 0.5 }] }],
  })

  it('liefert für gleiche Werte denselben Hash', () => {
    expect(objectHash(menu())).toBe(objectHash(menu()))
  })

  it('ändert den Hash bei einer Änderung am Feld einer verschachtelten Option', () => {
    const changed = menu()
    changed.og[0].options[0].productId = 'kuchen'
    expect(objectHash(changed)).not.toBe(objectHash(menu()))
  })

  it('ändert den Hash bei einem Feld der Gruppe, das oben keinen Namen trägt', () => {
    const changed = menu()
    changed.og[0].minSelections = 2
    expect(objectHash(changed)).not.toBe(objectHash(menu()))
  })

  it('ändert den Hash, wenn ein verschachteltes Feld neu hinzukommt', () => {
    const changed = { ...menu(), og: [{ ...menu().og[0], pricingMode: 'HIGHEST' }] }
    expect(objectHash(changed)).not.toBe(objectHash(menu()))
  })

  it('ändert den Hash bei geänderter Reihenfolge der Listeneinträge', () => {
    const a = { og: [{ id: 'a' }, { id: 'b' }] }
    const b = { og: [{ id: 'b' }, { id: 'a' }] }
    expect(objectHash(a)).not.toBe(objectHash(b))
  })

  it('ignoriert die Schlüsselreihenfolge auf jeder Ebene', () => {
    const a = { name: 'x', og: [{ id: 'og-1', options: [{ productId: 'cola', priceAdjustment: 1 }] }] }
    const b = { og: [{ options: [{ priceAdjustment: 1, productId: 'cola' }], id: 'og-1' }], name: 'x' }
    expect(objectHash(a)).toBe(objectHash(b))
  })

  it('unterscheidet null, leere Werte und Zahlen im verschachtelten Feld', () => {
    const hashes = [null, '', 0, false].map(v => objectHash({ a: { b: v } }))
    expect(new Set(hashes).size).toBe(4)
  })

  it('verträgt Primitive und null als Wurzel', () => {
    expect(objectHash(null)).toBe(objectHash(null))
    expect(objectHash('a')).not.toBe(objectHash('b'))
    expect(objectHash(undefined)).toEqual(expect.any(String))
  })
})
