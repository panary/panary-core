import { describe, expect, it } from 'vitest'
import { closingStepViews, closingSteps } from './closing-flow'

describe('closingSteps — Folge der Abschlusskette (core#1069)', () => {
  it('nennt Pager, Tisch und Zeit, wenn alles an ist und außer Haus bestellt wird', () => {
    expect(closingSteps({ showPagers: true, showTables: true, takeOut: true })).toEqual(['pager', 'table', 'time'])
  })

  it('überspringt den Tisch, wenn die Filiale keine Tische führt', () => {
    expect(closingSteps({ showPagers: true, showTables: false, takeOut: true })).toEqual(['pager', 'time'])
  })

  it('lässt die Zeit im Haus weg', () => {
    expect(closingSteps({ showPagers: true, showTables: true, takeOut: false })).toEqual(['pager', 'table'])
  })

  it('kennt den Tisch nur nach dem Pager, wie die Kasse ihn erreicht', () => {
    expect(closingSteps({ showPagers: false, showTables: true, takeOut: true })).toEqual(['time'])
  })
})

describe('closingStepViews — Zustand je Schritt (core#1069)', () => {
  const steps = closingSteps({ showPagers: true, showTables: true, takeOut: true })

  it('markiert erledigt, aktuell und offen und zeigt den gewählten Pager', () => {
    expect(closingStepViews(steps, 'table', { pager: 7 })).toEqual([
      { key: 'pager', label: 'Pager', state: 'done', value: 'Pager 7' },
      { key: 'table', label: 'Tisch', state: 'current', value: null },
      { key: 'time', label: 'Zeit', state: 'next', value: null },
    ])
  })

  it('meldet einen übersprungenen Schritt ohne Wert', () => {
    const views = closingStepViews(steps, 'time', { pager: null, table: undefined })
    expect(views.map(v => [v.state, v.value])).toEqual([
      ['done', null],
      ['done', null],
      ['current', null],
    ])
  })

  it('nennt den gewählten Tisch', () => {
    expect(closingStepViews(steps, 'time', { pager: 3, table: '12' })[1].value).toBe('Tisch 12')
  })

  it('zeigt nichts außerhalb der Kette', () => {
    expect(closingStepViews(steps, null, {})).toEqual([])
  })
})
