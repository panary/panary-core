// Policy fuer den Auto-Logoff am POS-Terminal — Single Source of Truth fuer
// Edge, Cloud und POS-Client.
//
// Das Flag `autoLogOff` steuert, ob sich ein Mitarbeiter nach Inaktivitaet
// automatisch abmeldet. Die Dauer haengt nicht am Mitarbeiter, sondern an der
// Filiale (`resolveAutoLogOffTimeoutMs` in @panary/locations/domain) — die
// beiden Felder sind bewusst entkoppelt: „ob" ist eine Personalentscheidung,
// „wie lange" eine Betriebsentscheidung.

/**
 * Ist der Auto-Logoff fuer diesen Mitarbeiter aktiv?
 *
 * Existiert als eigener Helfer, weil das Flag auf dem Weg zum Client durch
 * SQLite laeuft: dort gibt es keinen Boolean-Typ, der Edge liefert `0`/`1`
 * (einen `coerceBooleanFields`-Hook gibt es nur in panary-cloud, nicht am
 * Edge). Ein `=== true` wuerde still nie greifen und der Auto-Logoff waere
 * wirkungslos. `'0'`/`'false'` fangen zusaetzlich den Fall ab, dass der Wert
 * irgendwo als String durchgereicht wird — `Boolean('0')` waere sonst `true`.
 *
 * ACHTUNG, Unterschied zu `requiresPosPinChange`: dort ist ein fehlender Wert
 * `false`, hier `true`. Der Grund ist das Schema-Default (`autoLogOff` ist
 * `Type.Boolean({ default: true })`) plus die Fail-Secure-Richtung: ein
 * Sitzungs-Record ohne das Feld — etwa eine Anmeldung von vor dem Update —
 * darf die Kasse nicht dauerhaft offen stehen lassen. Bitte nicht als
 * Copy-Paste-Fehler „korrigieren".
 */
export const isAutoLogOffEnabled = (user: { autoLogOff?: unknown } | null | undefined): boolean => {
  const value = user?.autoLogOff
  if (value === undefined || value === null) return true
  if (value === '0' || value === 'false') return false
  return Boolean(value)
}
