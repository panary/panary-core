/**
 * Reihenfolge der Mitarbeiterwahl am POS-Login. Ohne Angular, damit sie sich ohne TestBed
 * prüfen lässt.
 */

export interface StaffPerson {
  _id: string
  firstName: string
  lastName: string
}

/** Alphabetisch nach Nachname, dann Vorname — stabil für die gleiche Kachelreihenfolge am Terminal. */
export const sortStaff = <TPerson extends StaffPerson>(people: readonly TPerson[]): TPerson[] =>
  [...people].sort((a, b) => a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de'))

/** Kurzname für die Kachel: Vorname und Initial des Nachnamens (`Anna A.`); ohne Nachnamen nur der Vorname. */
export const shortStaffName = (person: StaffPerson): string => {
  const initial = person.lastName.trim().charAt(0).toUpperCase()
  return initial ? `${person.firstName} ${initial}.` : person.firstName
}
