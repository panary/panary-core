import { describe, expect, it } from 'vitest'
import {
  countByLetterGroup,
  filterStaff,
  foldForSearch,
  LETTER_GROUPS,
  letterGroupIndex,
  letterGroupLabel,
  MAX_RECENT_STAFF,
  pushRecentStaffId,
  readRecentStaffIds,
  RECENT_STAFF_STORAGE_KEY,
  resolveRecentStaff,
  sortStaff,
} from './staff-picker.logic'

const person = (_id: string, firstName: string, lastName: string) => ({ _id, firstName, lastName })

/** Je Test ein eigener Speicher (testing.md §10). */
const memoryStorage = (initial?: string) => {
  const store = new Map<string, string>(initial === undefined ? [] : [[RECENT_STAFF_STORAGE_KEY, initial]])
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  }
}

const STAFF = [
  person('1', 'Max', 'Müller'),
  person('2', 'Nora', 'Nolte'),
  person('3', 'Olaf', 'Özdemir'),
  person('4', 'Anna', 'Albrecht'),
  person('5', 'Zoe', 'Zimmer'),
  person('6', 'Ines', 'Meier'),
]

describe('Buchstabengruppen', () => {
  it('schneidet acht Gruppen mit Anzeigename A–C … V–Z', () => {
    expect(LETTER_GROUPS.map(letterGroupLabel)).toEqual(['A–C', 'D–F', 'G–I', 'J–L', 'M–O', 'P–R', 'S–U', 'V–Z'])
  })

  it('ordnet nach Nachname, Umlaute zählen als Grundbuchstabe', () => {
    expect(letterGroupIndex(person('x', 'Max', 'Müller'))).toBe(4)
    expect(letterGroupIndex(person('x', 'Olaf', 'Özdemir'))).toBe(4)
    expect(letterGroupIndex(person('x', 'Zoe', 'Zimmer'))).toBe(7)
  })

  it('fällt ohne Nachnamen auf den Vornamen zurück und meldet Nicht-Buchstaben mit -1', () => {
    expect(letterGroupIndex(person('x', 'Anna', ''))).toBe(0)
    expect(letterGroupIndex(person('x', '1', '2'))).toBe(-1)
  })

  it('zählt je Gruppe, damit leere ausgegraut werden können', () => {
    expect(countByLetterGroup(STAFF)).toEqual([1, 0, 0, 0, 4, 0, 0, 1])
  })
})

describe('Suche', () => {
  it('findet „mül" über Müller und „mul" ebenso (Diakritika ignoriert)', () => {
    expect(filterStaff(STAFF, 'mül', null).map(p => p._id)).toEqual(['1'])
    expect(filterStaff(STAFF, 'MUL', null).map(p => p._id)).toEqual(['1'])
  })

  it('findet über Vor- und Nachname und in beiden Reihenfolgen', () => {
    expect(filterStaff(STAFF, 'nora', null).map(p => p._id)).toEqual(['2'])
    expect(filterStaff(STAFF, 'nolte nora', null).map(p => p._id)).toEqual(['2'])
    expect(filterStaff(STAFF, 'nora nolte', null).map(p => p._id)).toEqual(['2'])
  })

  it('gewinnt gegen die Gruppenwahl, sonst verschwänden Treffer außerhalb der Gruppe', () => {
    expect(filterStaff(STAFF, 'zimmer', 0).map(p => p._id)).toEqual(['5'])
  })

  it('filtert ohne Suchtext nach Gruppe und liefert ohne beides alle', () => {
    expect(filterStaff(STAFF, '  ', 4).map(p => p._id)).toEqual(['1', '2', '3', '6'])
    expect(filterStaff(STAFF, '', null)).toHaveLength(STAFF.length)
  })

  it('faltet ß, ø und æ', () => {
    expect(foldForSearch('Groß Søren Æble')).toBe('gross soren aeble')
  })

  it('sortiert nach Nachname, dann Vorname, ohne die Eingabe zu verändern', () => {
    const input = [person('a', 'Zed', 'Berg'), person('b', 'Amy', 'Berg'), person('c', 'Bo', 'Aal')]
    expect(sortStaff(input).map(p => p._id)).toEqual(['c', 'b', 'a'])
    expect(input.map(p => p._id)).toEqual(['a', 'b', 'c'])
  })
})

describe('Zuletzt hier', () => {
  it('legt nur IDs ab, die neueste vorn, ohne Duplikat, höchstens sechs', () => {
    const storage = memoryStorage()
    for (const id of ['1', '2', '3', '4', '5', '6', '7']) pushRecentStaffId(id, storage)
    pushRecentStaffId('4', storage)

    const stored = JSON.parse(storage.store.get(RECENT_STAFF_STORAGE_KEY) as string)
    expect(stored).toEqual(['4', '7', '6', '5', '3', '2'])
    expect(stored).toHaveLength(MAX_RECENT_STAFF)
  })

  it('liest Müll als leere Liste und verwirft Nicht-Strings und Duplikate', () => {
    expect(readRecentStaffIds(memoryStorage('{kaputt'))).toEqual([])
    expect(readRecentStaffIds(memoryStorage('{"a":1}'))).toEqual([])
    expect(readRecentStaffIds(memoryStorage('["a",1,null,"a","","b"]'))).toEqual(['a', 'b'])
    expect(readRecentStaffIds(null)).toEqual([])
  })

  it('übersteht einen Speicher, der beim Schreiben wirft', () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(pushRecentStaffId('9', throwing)).toEqual(['9'])
  })

  it('zeigt nur Personen, die auf diesem Gerät auswählbar sind, in gespeicherter Reihenfolge', () => {
    expect(resolveRecentStaff(STAFF, ['5', 'fremd', '1']).map(p => p._id)).toEqual(['5', '1'])
  })
})
