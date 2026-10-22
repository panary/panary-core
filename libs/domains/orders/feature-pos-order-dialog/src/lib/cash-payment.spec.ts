import { describe, expect, it } from 'vitest'
import {
  appendCashDigit,
  canCollect,
  changeCents,
  MAX_GIVEN_CENTS,
  quickAmounts,
  removeCashDigit,
  toCents,
} from './cash-payment'

describe('Bezahlansicht — Eingabe in Cent', () => {
  it('schiebt Ziffern von rechts ein: 5, 0, 0 → 500 Cent', () => {
    const cents = [5, 0, 0].reduce(appendCashDigit, 0)
    expect(cents).toBe(500)
  })

  it('löscht die letzte Ziffer und bleibt bei 0 stehen', () => {
    expect(removeCashDigit(1790)).toBe(179)
    expect(removeCashDigit(5)).toBe(0)
    expect(removeCashDigit(0)).toBe(0)
  })

  it('deckelt die Eingabe bei 100 000 €', () => {
    const cents = Array.from({ length: 12 }, () => 9).reduce(appendCashDigit, 0)
    expect(cents).toBe(MAX_GIVEN_CENTS)
  })

  it('ignoriert Werte, die keine Ziffer sind', () => {
    expect(appendCashDigit(120, 10)).toBe(120)
    expect(appendCashDigit(120, -1)).toBe(120)
    expect(appendCashDigit(120, 1.5)).toBe(120)
  })

  it('rundet Euro auf ganze Cent (17,90 € ist 1790, nicht 1789)', () => {
    expect(toCents(17.9)).toBe(1790)
    expect(toCents(0.07 + 0.01)).toBe(8)
  })
})

describe('Bezahlansicht — Rückgeld und Freigabe', () => {
  it('rechnet Rückgeld aus gegeben minus Summe', () => {
    expect(changeCents(2000, 1790)).toBe(210)
    expect(changeCents(1790, 1790)).toBe(0)
  })

  it('zeigt bei zu wenig Geld 0 statt eines negativen Rückgelds', () => {
    expect(changeCents(1000, 1790)).toBe(0)
  })

  it('lässt Kassieren erst bei gedeckter Summe zu', () => {
    expect(canCollect(1789, 1790)).toBe(false)
    expect(canCollect(1790, 1790)).toBe(true)
    expect(canCollect(5000, 1790)).toBe(true)
  })

  it('lässt bei Summe 0 nicht kassieren, auch mit „gegeben" 0', () => {
    expect(canCollect(0, 0)).toBe(false)
  })
})

describe('Bezahlansicht — Schnellbeträge', () => {
  it('bietet die nächsten Scheine über der Summe, höchstens drei', () => {
    expect(quickAmounts(1790)).toEqual([2000, 5000, 10000])
    expect(quickAmounts(100)).toEqual([500, 1000, 2000])
  })

  it('nimmt „genau ein Schein" nicht als Schnellbetrag — dafür gibt es „Passend"', () => {
    expect(quickAmounts(2000)).toEqual([5000, 10000, 20000])
  })

  it('bietet über dem größten Schein nichts mehr an', () => {
    expect(quickAmounts(20000)).toEqual([])
  })
})
