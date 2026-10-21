// Policy fuer die Bedienhand am POS-Terminal — Single Source of Truth fuer den
// Default, damit POS-Client, Edge und Cloud-Admin „Feld fehlt" gleich lesen.

import { PosHandedness } from './user.schema'

/**
 * Fehlt `posHandedness`, sitzt der Warenkorb links — Position wie vor der
 * Einfuehrung des Feldes. So wandert fuer Bestands-Mitarbeiter nichts, rechts gibt
 * es nur nach eigener Wahl (Entscheidung im Anker panary/panary-core#819).
 */
export const DEFAULT_POS_HANDEDNESS: PosHandedness = PosHandedness.LEFT

const KNOWN_VALUES: ReadonlySet<unknown> = new Set<unknown>(Object.values(PosHandedness))

/**
 * Wirksame Bedienhand eines Mitarbeiters. Nimmt `unknown`, weil der Wert auf dem
 * Weg zum Client durch SQLite laeuft (leere Spalte = `null`) und ein Sitzungs-
 * Record von vor dem Update das Feld gar nicht kennt — beides ergibt den Default
 * statt eines kaputten Layouts.
 */
export const resolvePosHandedness = (user: { posHandedness?: unknown } | null | undefined): PosHandedness => {
  const value = user?.posHandedness
  return KNOWN_VALUES.has(value) ? (value as PosHandedness) : DEFAULT_POS_HANDEDNESS
}
