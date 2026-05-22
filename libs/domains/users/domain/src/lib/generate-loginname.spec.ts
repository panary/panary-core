import { ensureUniqueLoginname, generateLoginname } from './generate-loginname'

describe('generateLoginname', () => {
  it('bildet erster-Buchstabe-Vorname + Nachname', () => {
    expect(generateLoginname({ firstName: 'Max', lastName: 'Mustermann' })).toBe('mmustermann')
  })

  it('transliteriert deutsche Umlaute (ü→ue)', () => {
    expect(generateLoginname({ firstName: 'Tom', lastName: 'Müller' })).toBe('tmueller')
    expect(generateLoginname({ firstName: 'Ön', lastName: 'Çelik' })).toBe('ocelik')
    expect(generateLoginname({ firstName: 'A', lastName: 'Straße' })).toBe('astrasse')
  })

  it('strippt Diakritika und Sonderzeichen', () => {
    expect(generateLoginname({ firstName: 'José', lastName: "O'Néill" })).toBe('joneill')
  })

  it('faellt auf den E-Mail-Local-Part zurueck, wenn kein Name vorliegt', () => {
    expect(generateLoginname({ email: 'max@cafe.de' })).toBe('max')
    expect(generateLoginname({ firstName: '', lastName: '', email: 'a.b-c@x.de' })).toBe('abc')
  })

  it('faellt auf u+employeeNumber zurueck, wenn weder Name noch E-Mail brauchbar', () => {
    expect(generateLoginname({ employeeNumber: '412009' })).toBe('u412009')
  })

  it('faellt auf u+Random (7 Zeichen) zurueck, wenn gar nichts vorliegt', () => {
    const result = generateLoginname({})
    expect(result).toMatch(/^u\d{6}$/)
  })

  it('nutzt nur den Vornamen, wenn kein Nachname existiert', () => {
    expect(generateLoginname({ firstName: 'Anna' })).toBe('anna')
  })

  it('begrenzt auf 30 Zeichen', () => {
    const result = generateLoginname({ firstName: 'X', lastName: 'a'.repeat(50) })
    expect(result.length).toBe(30)
  })

  it('ueberspringt zu kurze Bases (< 2 Zeichen) und nutzt den Fallback', () => {
    // Nur 1-Buchstabe-Vorname, kein Nachname → base 'b' (1 Zeichen) → E-Mail-Fallback
    expect(generateLoginname({ firstName: 'B', email: 'fallback@x.de' })).toBe('fallback')
  })
})

describe('ensureUniqueLoginname', () => {
  it('gibt die Basis zurueck, wenn sie frei ist', async () => {
    const result = await ensureUniqueLoginname('mmustermann', async () => false)
    expect(result).toBe('mmustermann')
  })

  it('haengt einen numerischen Suffix an, bis frei', async () => {
    const taken = new Set(['mmustermann', 'mmustermann2'])
    const result = await ensureUniqueLoginname('mmustermann', async (c) => taken.has(c))
    expect(result).toBe('mmustermann3')
  })

  it('haelt MAX_LENGTH=30 auch mit Suffix ein', async () => {
    const base = 'a'.repeat(30)
    const result = await ensureUniqueLoginname(base, async (c) => c === base)
    expect(result.length).toBe(30)
    expect(result.endsWith('2')).toBe(true)
  })
})
