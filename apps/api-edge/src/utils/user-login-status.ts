// Status-Gate fuer jeden Anmeldeweg am Edge (panary/panary-core#187).
//
// Bis #187 war `status` am Edge ein reines Anzeigefeld: Die Cloud-Reconciliation
// setzte `ARCHIVED`, der Kommentar dort behauptete eine Sperrwirkung — es gab
// aber weder einen Login-Guard noch einen Listen-Filter. Am laufenden Edge
// nachgemessen: Ein archivierter Mitarbeiter meldete sich unveraendert per
// Passwort **und** per POS-PIN an, blieb im Personalauswahl-Screen stehen, und
// eine bereits offene Sitzung lief weiter.
//
// Die Cloud (api-cloud/src/authentication.ts) kennt dieselbe Pruefung seit M2.
// Bewusst edge-lokal gehalten statt in `@panary/users/domain`: eine
// Domain-Aenderung zoege einen Pin-Bump der Cloud nach sich, die den Guard
// laengst hat.
import { UserStatus } from '@panary/users/domain'

/** Nur das, was fuer die Entscheidung noetig ist — passt auf User und JWT-Entity. */
export interface LoginStatusCandidate {
  status?: string | null
  role?: string | null
}

/**
 * `true`, sobald der Datensatz einen Status traegt, der nicht `ACTIVE` ist
 * (`ARCHIVED`, `REJECTED`).
 *
 * Ein **fehlender** Status laesst bewusst durch: Der von `allowApiKey`
 * erzeugte virtuelle Geraete-User (`device:<deviceId>`) hat keinen — er ist
 * kein Personendatensatz, und ein fail-closed an dieser Stelle wuerde jedes
 * Terminal aussperren, sobald es sich per API-Key verbindet.
 */
export const isLoginBlockedByStatus = (candidate: LoginStatusCandidate | null | undefined): boolean => {
  const status = candidate?.status
  return typeof status === 'string' && status.length > 0 && status !== UserStatus.ACTIVE
}

/**
 * Einheitliche Meldung fuer alle Anmeldewege. Bewusst ohne den konkreten Status:
 * die Unterscheidung „archiviert" vs. „abgelehnt" waere ein Existenz-Oracle fuer
 * jeden, der am Terminal steht.
 */
export const LOGIN_BLOCKED_MESSAGE = 'Dieses Benutzerkonto ist nicht aktiv.'
