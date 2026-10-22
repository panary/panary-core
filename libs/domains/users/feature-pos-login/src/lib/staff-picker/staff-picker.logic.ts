/**
 * Reine Logik der Mitarbeiterwahl am POS-Login (panary/panary-core#835): Buchstabengruppen,
 * Suche und die gerätelokale „Zuletzt hier"-Liste. Ohne Angular, damit sie sich ohne
 * TestBed prüfen lässt.
 */

export interface StaffPerson {
  _id: string
  firstName: string
  lastName: string
}

/**
 * Acht Gruppen statt 23 Einzelbuchstaben: Bei 23 Kacheln pro Zeile unterschritt jede die
 * 48-px-Touchfläche. Die Gruppen sind so geschnitten, dass bei deutschen Nachnamen keine
 * allzu leer bleibt (Z hängt an V–Z).
 */
export const LETTER_GROUPS: readonly string[] = ['ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQR', 'STU', 'VWXYZ']

/** Anzeigename der Gruppe, z. B. `A–C`, `V–Z`. */
export const letterGroupLabel = (group: string): string => `${group[0]}–${group[group.length - 1]}`

/**
 * Kleinbuchstaben ohne Diakritika: `Müller` → `muller`, so findet die Suche „mül" wie „mul".
 * `ß`/`ø`/`æ` zerlegt NFD nicht, sie werden eigens abgebildet.
 */
export const foldForSearch = (value: string): string =>
  value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae')

/** Index der Buchstabengruppe für den Nachnamen (Vorname als Rückfall), `-1` bei Nicht-Buchstaben. */
export const letterGroupIndex = (person: StaffPerson): number => {
  const source = foldForSearch((person.lastName || person.firstName || '').trim())
  const letter = source.charAt(0).toUpperCase()
  return LETTER_GROUPS.findIndex(group => group.includes(letter))
}

/** Alphabetisch nach Nachname, dann Vorname — stabil für die gleiche Kachelreihenfolge am Terminal. */
export const sortStaff = <TPerson extends StaffPerson>(people: readonly TPerson[]): TPerson[] =>
  [...people].sort((a, b) => a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de'))

/** Wie viele Personen je Buchstabengruppe — leere Gruppen werden in der UI ausgegraut. */
export const countByLetterGroup = (people: readonly StaffPerson[]): number[] => {
  const counts = LETTER_GROUPS.map(() => 0)
  for (const person of people) {
    const index = letterGroupIndex(person)
    if (index >= 0) counts[index]++
  }
  return counts
}

/**
 * Filtert nach Suchtext (Vor- oder Nachname, auch in der Reihenfolge „Nachname Vorname") und
 * optionaler Buchstabengruppe. Bei gesetztem Suchtext gewinnt die Suche: Eine Gruppenwahl
 * davor würde Treffer außerhalb der Gruppe verstecken.
 */
export const filterStaff = <TPerson extends StaffPerson>(
  people: readonly TPerson[],
  query: string,
  groupIndex: number | null,
): TPerson[] => {
  const needle = foldForSearch(query.trim())
  if (needle) {
    return people.filter(person => {
      const first = foldForSearch(person.firstName)
      const last = foldForSearch(person.lastName)
      return (
        first.includes(needle) ||
        last.includes(needle) ||
        `${first} ${last}`.includes(needle) ||
        `${last} ${first}`.includes(needle)
      )
    })
  }
  if (groupIndex === null) return [...people]
  return people.filter(person => letterGroupIndex(person) === groupIndex)
}

//#region Zuletzt hier (gerätelokal)
/**
 * Nur IDs, nie Namen oder PINs: Das ist die einzige Personenangabe, die der Login im
 * localStorage ablegen darf. Keine Schemaänderung — die Reihenfolge gilt je Terminal.
 */
export const RECENT_STAFF_STORAGE_KEY = 'pnry_login_recent_staff'

export const MAX_RECENT_STAFF = 6

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const defaultStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Liest die gespeicherte ID-Liste; Müll (kein Array, Nicht-Strings, Duplikate) wird verworfen. */
export const readRecentStaffIds = (storage: StorageLike | null = defaultStorage()): string[] => {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(RECENT_STAFF_STORAGE_KEY) ?? 'null')
    if (!Array.isArray(parsed)) return []
    const ids = parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)
    return [...new Set(ids)].slice(0, MAX_RECENT_STAFF)
  } catch {
    return []
  }
}

/** Setzt die ID an die erste Stelle, entfernt ihr früheres Vorkommen und kappt auf sechs. */
export const pushRecentStaffId = (userId: string, storage: StorageLike | null = defaultStorage()): string[] => {
  const next = [userId, ...readRecentStaffIds(storage).filter(id => id !== userId)].slice(0, MAX_RECENT_STAFF)
  try {
    storage?.setItem(RECENT_STAFF_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // localStorage nicht verfügbar — die Liste ist Komfort, kein Login-Bestandteil
  }
  return next
}

/** Die IDs in gespeicherter Reihenfolge, aber nur Personen, die auf diesem Gerät auswählbar sind. */
export const resolveRecentStaff = <TPerson extends StaffPerson>(
  people: readonly TPerson[],
  recentIds: readonly string[],
): TPerson[] => {
  const byId = new Map(people.map(person => [person._id, person]))
  return recentIds.flatMap(id => byId.get(id) ?? [])
}
//#endregion
