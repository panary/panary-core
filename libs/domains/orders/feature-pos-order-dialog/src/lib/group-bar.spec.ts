import { describe, expect, it } from 'vitest'
import { fittingGroupCount, splitGroupBar } from './group-bar'

// rem = 16 px: Abstand 8 px, Burger 48 px. Fünf Gruppen à 100 px brauchen 5 × 100 + 4 × 8 = 532 px.
const REM = 16
const groups = (n: number) => Array.from({ length: n }, (_, i) => `G${i + 1}`)
const widths = (n: number, px = 100) => Array.from({ length: n }, () => px)

describe('Gruppenleiste — eine Zeile mit Burger (core#908)', () => {
  it('zeigt alle Gruppen ohne Burger, solange die Zeile reicht — auf den Pixel genau', () => {
    expect(fittingGroupCount(widths(5), 532, REM)).toBe(5)
  })

  it('hält ab einem Pixel zu wenig Platz für Burger und Abstand frei', () => {
    // 531 − 48 − 8 = 475 px: vier Gruppen (424 px) passen, die fünfte (532 px) nicht.
    expect(fittingGroupCount(widths(5), 531, REM)).toBe(4)
  })

  it('rechnet mit den gemessenen Breiten, nicht mit einer Einheitsbreite', () => {
    // Neben dem Burger bleiben 300 − 48 − 8 = 244 px: 60 + 8 + 200 = 268 passt nicht, 60 + 8 + 60 = 128 schon.
    expect(fittingGroupCount([60, 200, 60], 300, REM)).toBe(1)
    expect(fittingGroupCount([60, 60, 200], 300, REM)).toBe(2)
  })

  it('lässt keine schmale Gruppe von hinten in eine Lücke vorrücken', () => {
    // Die dritte (40 px) passte neben die erste, steht aber hinter der zu breiten zweiten.
    expect(fittingGroupCount([60, 400, 40], 300, REM)).toBe(1)
  })

  it('wächst mit der Dichte: größere rem heißt größerer Burger und Abstand', () => {
    // 500 − 48 − 8 = 444 px → vier Gruppen; bei 1,3: 500 − 62,4 − 10,4 = 427,2 px → drei (431,2 px passen nicht).
    expect(fittingGroupCount(widths(5), 500, REM)).toBe(4)
    expect(fittingGroupCount(widths(5), 500, 16 * 1.3)).toBe(3)
  })

  it('zeigt bei winziger Breite nur den Burger', () => {
    expect(fittingGroupCount(widths(3), 40, REM)).toBe(0)
  })
})

describe('Gruppenleiste — Aufteilung (core#908)', () => {
  it('legt die Gruppen hinter die gemessene Grenze ins Burger-Menü', () => {
    expect(splitGroupBar(groups(5), widths(5), 531, REM)).toEqual({
      visible: groups(4),
      overflow: ['G5'],
    })
  })

  it('verliert keine Gruppe und dupliziert keine', () => {
    const all = groups(40)
    const split = splitGroupBar(all, widths(40, 90), 900, REM)

    expect(split.overflow.length).toBeGreaterThan(0)
    expect([...split.visible, ...split.overflow]).toEqual(all)
  })
})
