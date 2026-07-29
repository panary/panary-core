// Policy fuer die `users.changePin`-Custom-Method — Single Source of Truth fuer
// Edge (apps/api-edge) und Cloud (apps/api-cloud), analog self-patch-policy.ts.
//
// Warum eine eigene Methode statt eines regulaeren PATCH auf `users`:
// Der POS-Client authentifiziert sich per API-Key als GERAET
// (`device:pos-client`), nicht als Mitarbeiter — es gibt am Edge keine
// Mitarbeiter-Session. Ein regulaerer Patch scheitert deshalb an
// `restrictUserSelfPatch` (FOREIGN_RECORD), und dem Geraet `users:UPDATE` zu
// geben wuerde beliebige User-Patches erlauben.
//
// Die Autorisierung des GERAETS leistet die Ability CAN_CHANGE_POS_PIN. Die
// Bindung an die PERSON leistet ausschliesslich `currentPin` (bcrypt-Vergleich
// im jeweiligen Backend). Ohne diesen Beweis koennte jeder am Terminal eine
// beliebige `userId` waehlen und den PIN eines Kollegen ueberschreiben.
//
// Framework-agnostisch: Verletzungen werden strukturiert zurueckgegeben statt
// geworfen; der Feathers-Adapter im Backend mappt sie auf die HTTP-Fehler.

import { PRIVILEGED_ROLES } from './self-patch-policy'

/**
 * Zulaessige Laenge einer POS-PIN bei der Eingabe.
 *
 * Bewusst exakt 4 und nicht 4-6: der Ziffernblock im POS-Login akzeptiert
 * genau vier Stellen (Auto-Submit bei der vierten). Eine laengere PIN liesse
 * sich am Terminal nie eingeben und wuerde den Mitarbeiter aussperren.
 * Das Speicher-Schema (`posPin`) bleibt bei 4-6, damit Bestands-Hashes aus
 * frueher vergebenen laengeren PINs gueltig bleiben.
 */
export const POS_PIN_LENGTH = 4
export const POS_PIN_PATTERN = /^[0-9]{4}$/

/**
 * Muss dieser Mitarbeiter beim Login zum PIN-Wechsel gezwungen werden?
 *
 * Existiert als eigener Helfer, weil das Flag auf dem Weg zum Client durch
 * SQLite laeuft: dort gibt es keinen Boolean-Typ, der Edge liefert `0`/`1`.
 * Ein `=== true` wuerde still nie greifen und der Zwang waere wirkungslos.
 * `'0'` faengt zusaetzlich den Fall ab, dass der Wert irgendwo als String
 * durchgereicht wird — `Boolean('0')` waere sonst `true`.
 */
export const requiresPosPinChange = (user: { mustChangePosPin?: unknown } | null | undefined): boolean => {
  const value = user?.mustChangePosPin
  if (value === '0' || value === 'false') return false
  return Boolean(value)
}

export interface ChangePinActor {
  _id?: string
  role?: string
}

export interface ChangePinInput {
  userId?: string
  currentPin?: string
  newPin?: string
}

export interface ChangePinViolation {
  reason: 'MISSING_INPUT' | 'INVALID_FORMAT' | 'SAME_PIN' | 'FOREIGN_RECORD'
  /** Client-stabile Meldung — Adapter werfen sie unveraendert. */
  message: string
}

const isDeviceRole = (role: string | undefined): boolean => Boolean(role?.startsWith('device:'))

/**
 * Prueft Eingabe und Self-Scope eines PIN-Wechsels. Liefert `null`, wenn der
 * Request formal in Ordnung ist — die eigentliche Identitaetspruefung
 * (`currentPin` gegen den bcrypt-Hash) passiert danach im Backend.
 */
export const checkChangePinRequest = (
  actor: ChangePinActor | undefined,
  input: ChangePinInput,
): ChangePinViolation | null => {
  const { userId, currentPin, newPin } = input

  if (!userId || !currentPin || !newPin) {
    return { reason: 'MISSING_INPUT', message: 'userId, currentPin und newPin sind erforderlich.' }
  }

  if (!POS_PIN_PATTERN.test(newPin)) {
    return {
      reason: 'INVALID_FORMAT',
      message: `Die PIN muss aus genau ${POS_PIN_LENGTH} Ziffern bestehen.`,
    }
  }

  if (currentPin === newPin) {
    return { reason: 'SAME_PIN', message: 'Die neue PIN darf nicht der bisherigen entsprechen.' }
  }

  // Geraete-Rollen duerfen fuer jeden Mitarbeiter aufrufen — sie bedienen alle
  // Mitarbeiter am selben Terminal und weisen sich ueber `currentPin` aus.
  // Echte User-Sessions (Admin-Client) duerfen nur den eigenen PIN aendern,
  // ausser sie tragen eine privilegierte Rolle. Spiegelt checkUserSelfPatch,
  // das hier wegen `provider: undefined` nicht greift.
  const role = actor?.role
  if (role && !isDeviceRole(role) && !PRIVILEGED_ROLES.has(role) && actor?._id !== userId) {
    return {
      reason: 'FOREIGN_RECORD',
      message: 'Die PIN kann nur vom eingeloggten Benutzer selbst geaendert werden.',
    }
  }

  return null
}
