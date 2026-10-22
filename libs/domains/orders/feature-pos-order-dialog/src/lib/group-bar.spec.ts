import { describe, expect, it } from 'vitest'
import { groupColumns, splitGroupBar } from './group-bar'

// Konzept §4: 1366×768 ohne Rail-Spalte, Dichte 1,0 → 8 Gruppen je Zeile; 1920 → 11.
const groups = (n: number) => Array.from({ length: n }, (_, i) => `G${i + 1}`)

describe('Gruppenleiste — Felder je Zeile (core#829)', () => {
  it('rechnet wie auto-fill: Mindestbreite 9rem plus 0,5rem Abstand', () => {
    expect(groupColumns(1290 - 32, 16)).toBe(8)
    expect(groupColumns(1844 - 32, 16)).toBe(11)
  })

  it('wächst mit der Dichte: größere rem heißt weniger Felder', () => {
    expect(groupColumns(1290 - 32, 16 * 1.3)).toBe(6)
  })

  it('zeigt auch bei winziger Breite ein Feld', () => {
    expect(groupColumns(10, 16)).toBe(1)
  })
})

describe('Gruppenleiste — Aufteilung auf zwei Zeilen (core#829)', () => {
  it('zeigt alle Gruppen, solange zwei Zeilen reichen', () => {
    expect(splitGroupBar(groups(16), 1258, 16)).toEqual({ visible: groups(16), overflow: [] })
  })

  it('macht ab einer Gruppe zu viel das letzte Feld zu „Weitere"', () => {
    const split = splitGroupBar(groups(17), 1258, 16)

    expect(split.visible).toEqual(groups(15))
    expect(split.overflow).toEqual(['G16', 'G17'])
  })

  it('verliert keine Gruppe und dupliziert keine', () => {
    const all = groups(40)
    const split = splitGroupBar(all, 900, 16)

    expect([...split.visible, ...split.overflow]).toEqual(all)
  })
})
