import { describe, expect, it } from 'vitest'

import { menuOptionGroupSlot } from './menu-option-group-slot'

// Der Ausdruck, den `selectOptionGroupItem` vor core#1455 inline trug. Die Funktion muss ihn für jeden Namen gleich beantworten.
function bisherigerAusdruck(name: string | undefined): 'side' | 'drink' | null {
  const groupName = (name || '').toLowerCase()
  if (groupName.includes('beilage') || groupName.includes('side')) return 'side'
  if (groupName.includes('getränk') || groupName.includes('drink')) return 'drink'
  return null
}

describe('menuOptionGroupSlot', () => {
  it.each([
    ['Beilage', 'side'],
    ['Beilagen', 'side'],
    ['Side Dish', 'side'],
    ['Getränk', 'drink'],
    ['GETRÄNKE', 'drink'],
    ['Cold Drinks', 'drink'],
    ['Soße', null],
    ['Dazu', null],
    ['', null],
  ])('%s → %s', (name, slot) => {
    expect(menuOptionGroupSlot(name)).toBe(slot)
  })

  it('erkennt „Getraenk“ ohne Umlaut nicht — wie die Kasse', () => {
    expect(menuOptionGroupSlot('Getraenke')).toBeNull()
  })

  it('fehlender Name ist kein Platz', () => {
    expect(menuOptionGroupSlot(undefined)).toBeNull()
    expect(menuOptionGroupSlot(null)).toBeNull()
  })

  it('Beilage vor Getränk, wenn beides im Namen steht — wie der bisherige Ausdruck', () => {
    expect(menuOptionGroupSlot('Beilage oder Getränk')).toBe('side')
  })

  it('stimmt mit dem bisherigen Ausdruck für alle Namen überein', () => {
    for (const name of [
      'Beilage',
      'Side',
      'Getränk',
      'Drink',
      'Getraenk',
      'Soße',
      'Dazu',
      'Beilage+Getränk',
      '',
      'sIdEwAyS',
    ]) {
      expect(menuOptionGroupSlot(name)).toBe(bisherigerAusdruck(name))
    }
    expect(menuOptionGroupSlot(undefined)).toBe(bisherigerAusdruck(undefined))
  })
})
