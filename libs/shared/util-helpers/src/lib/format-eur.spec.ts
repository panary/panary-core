import { formatEur, formatEurCents } from './format-eur'

const nbsp = ' '

describe('formatEur', () => {
  it('formatiert de-DE mit zwei Nachkommastellen und Eurozeichen hinten', () => {
    expect(formatEur(16.5)).toBe(`16,50${nbsp}€`)
    expect(formatEur(4.2)).toBe(`4,20${nbsp}€`)
  })

  it('formatiert 0 als „0,00 €"', () => {
    expect(formatEur(0)).toBe(`0,00${nbsp}€`)
  })

  it('formatiert negative Werte mit Minus vor der Zahl', () => {
    expect(formatEur(-2.5)).toBe(`-2,50${nbsp}€`)
  })

  it('zeigt kein „-0,00 €"', () => {
    expect(formatEur(-0)).toBe(`0,00${nbsp}€`)
    expect(formatEur(-0.001)).toBe(`0,00${nbsp}€`)
  })

  it('setzt den Tausenderpunkt', () => {
    expect(formatEur(1234.5)).toBe(`1.234,50${nbsp}€`)
  })

  it('rundet auf Cent', () => {
    expect(formatEur(1.005)).toBe(`1,01${nbsp}€`)
    expect(formatEur(0.1 + 0.2)).toBe(`0,30${nbsp}€`)
  })

  it.each([null, undefined, NaN, Infinity])('liefert für %s einen leeren Text', v => {
    expect(formatEur(v)).toBe('')
  })
})

describe('formatEurCents', () => {
  it('rechnet Cent in Euro um', () => {
    expect(formatEurCents(1650)).toBe(`16,50${nbsp}€`)
    expect(formatEurCents(0)).toBe(`0,00${nbsp}€`)
    expect(formatEurCents(-250)).toBe(`-2,50${nbsp}€`)
  })

  it('liefert für null/undefined einen leeren Text', () => {
    expect(formatEurCents(null)).toBe('')
    expect(formatEurCents(undefined)).toBe('')
  })
})
