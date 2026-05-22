// Geteilte Pure-Function zur automatischen Erzeugung eines `loginname`-Handles.
// Wird von Edge UND Cloud im Create-Resolver-Pfad genutzt, damit beide Systeme
// denselben Algorithmus verwenden. `loginname` ist seit der E-Mail-Identitaets-
// Umstellung kein Login-Identifier mehr, sondern nur ein Anzeige-/Audit-Handle —
// daher genuegt hier eine deterministische, kollisionsarme Ableitung ohne harte
// Uniqueness. Die optionale Uniqueness uebernimmt `ensureUniqueLoginname` in der
// aufrufenden Schicht (nur im Nicht-Sync-Create).

const MIN_LENGTH = 2
const MAX_LENGTH = 30

/**
 * Normalisiert einen Namens-Teil auf `[a-z0-9]`: lowercase, deutsche Umlaute
 * transliterieren (ä→ae, ö→oe, ü→ue, ß→ss) VOR dem NFKD-Diakritika-Strip
 * (sonst wuerde `ü` zu `u` statt `ue`), dann verbleibende Combining-Marks (NFKD)
 * und alle Nicht-Alphanumerischen entfernen.
 */
const normalizePart = (raw: string | undefined | null): string => {
  if (!raw) return ''
  return raw
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '')
}

const clamp = (value: string): string => value.slice(0, MAX_LENGTH)

export interface GenerateLoginnameInput {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  employeeNumber?: string | null
}

/**
 * Erzeugt einen `loginname`-Handle nach der Regel „erster Buchstabe Vorname +
 * Nachname". Fallback-Kaskade, wenn kein verwertbarer Name vorliegt:
 * E-Mail-Local-Part → `'u' + employeeNumber` → `'u' + 6-stelliger Random`.
 *
 * Beispiele:
 *   { firstName: 'Max', lastName: 'Mustermann' } → 'mmustermann'
 *   { firstName: 'Tom', lastName: 'Müller' }      → 'tmueller'
 *   { email: 'max@cafe.de' }                      → 'max'
 *   { employeeNumber: '412009' }                  → 'u412009'
 */
export const generateLoginname = (input: GenerateLoginnameInput): string => {
  const first = normalizePart(input.firstName)
  const last = normalizePart(input.lastName)

  let base = ''
  if (first && last) base = first.slice(0, 1) + last
  else if (last) base = last
  else if (first) base = first

  if (base.length >= MIN_LENGTH) return clamp(base)

  const emailLocal = normalizePart(input.email?.split('@')[0])
  if (emailLocal.length >= MIN_LENGTH) return clamp(emailLocal)

  const employeeNumber = normalizePart(input.employeeNumber)
  if (employeeNumber) return clamp('u' + employeeNumber)

  const random = Math.floor(100000 + Math.random() * 900000).toString()
  return 'u' + random
}

/**
 * Haengt an einen Basis-Handle einen numerischen Suffix an und haelt dabei
 * `MAX_LENGTH` ein (z. B. base='mmustermann', n=2 → 'mmustermann2').
 */
const withSuffix = (base: string, n: number): string => {
  const suffix = String(n)
  return base.slice(0, MAX_LENGTH - suffix.length) + suffix
}

/**
 * Macht einen `loginname` best-effort eindeutig, indem bei Kollision ein
 * numerischer Suffix (2, 3, …) angehaengt wird. NUR im Nicht-Sync-Create
 * verwenden — im Sync-Pfad muss der eingehende Wert unveraendert durchgereicht
 * werden, sonst entsteht Edge↔Cloud-Ping-Pong. `exists` prueft typischerweise
 * tenant-scoped (z. B. `users.find({ loginname, tenantId })`).
 */
export const ensureUniqueLoginname = async (
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> => {
  if (!(await exists(base))) return base
  for (let n = 2; n <= 99; n++) {
    const candidate = withSuffix(base, n)
    if (!(await exists(candidate))) return candidate
  }
  return withSuffix(base, Math.floor(100 + Math.random() * 900))
}
