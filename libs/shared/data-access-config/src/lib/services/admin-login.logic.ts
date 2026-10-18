import type { AdminLoginMembership, AdminLoginRejection, LoginProofChallenge } from '../models/device-config.model'

/**
 * Antwort von `account-login` (panary-cloud) in drei Fälle sortiert.
 *
 * Bewusst eine lokale Minimalfassung von `classifyAccountLoginResponse` aus
 * panary-cloud (`libs/domains/auth/data-access/src/lib/auth.logic.ts`): core darf cloud
 * nicht importieren, und eine geteilte Lib hieße für diese drei Abfragen einen Core-Release
 * plus Pin-Bump in cloud. Der POS-Setup braucht weder die Passkey-Challenge noch die
 * Recovery-Code-Felder, nur die Unterscheidung. Ändert die Cloud ihre Antwortform, fällt
 * eine Antwort ohne Token hier als Fehler auf, statt als Sitzung gelesen zu werden.
 */
export type AccountLoginOutcome =
  { kind: 'token'; accessToken: string } | { kind: 'selection'; memberships: AdminLoginMembership[] } | { kind: 'mfa' }

const isMembership = (value: unknown): value is AdminLoginMembership =>
  typeof (value as { membershipId?: unknown } | null)?.membershipId === 'string' &&
  (value as { membershipId: string }).membershipId !== ''

export const classifyAccountLoginResponse = (response: unknown): AccountLoginOutcome => {
  const r = (response ?? {}) as Record<string, unknown>
  if (r['requiresSelection'] === true) {
    // Eine leere oder unbrauchbare Auswahl ließe das Formular wortlos stehen: kein Betrieb zum
    // Anklicken, keine Meldung. Sie ist deshalb ein Fehler wie eine Antwort ohne Token.
    const memberships = Array.isArray(r['memberships']) ? (r['memberships'] as unknown[]).filter(isMembership) : []
    if (memberships.length === 0) throw new Error('account-login: Auswahl ohne gültige Mitgliedschaft')
    return { kind: 'selection', memberships }
  }
  if (r['requiresMfa'] === true) return { kind: 'mfa' }
  if (typeof r['accessToken'] !== 'string' || r['accessToken'] === '') {
    throw new Error('account-login: Antwort ohne Token, Auswahl oder Zweitfaktor-Abfrage')
  }
  return { kind: 'token', accessToken: r['accessToken'] }
}

/**
 * Meldungen eines 401, hinter denen ein fehlender zweiter Faktor steht statt eines falschen
 * Passworts (panary-cloud `enforce-mfa.hook.ts`, `evaluateMfaStatus().blockedCode`).
 */
const MFA_BLOCKED_MESSAGES = new Set(['MFA_GRACE_EXPIRED', 'PLATFORM_MFA_ENROLLMENT_REQUIRED'])

const readRetryAfter = (data: unknown): number | undefined => {
  const value = (data as { retryAfter?: unknown } | null | undefined)?.retryAfter
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.ceil(value) : undefined
}

/**
 * Ordnet einen Fehler der Login-Phase einer Abweisung fürs Formular zu. `null` heißt: kein
 * Fall fürs Formular (Timeout, Verbindungsabbruch, unbekannter Code), der Aufrufer zeigt den
 * Fehler-Schritt wie bisher.
 *
 * Feathers-Fehler kommen über den Socket mit `code` (HTTP-Status), `message` und `data` an.
 * Die Cloud drosselt `account-login` mit 429 und `data.retryAfter` (lib/auth-attempt-limiter.ts),
 * das Hash-Gate antwortet unter Last mit 503, der Login-Nachweis mit 428 (core#755).
 */
export const classifyAdminLoginError = (error: unknown): AdminLoginRejection | null => {
  const e = (error ?? {}) as { code?: unknown; message?: unknown; data?: unknown }
  switch (e.code) {
    case 401:
      return typeof e.message === 'string' && MFA_BLOCKED_MESSAGES.has(e.message)
        ? { kind: 'mfa-required' }
        : { kind: 'invalid-credentials' }
    // Ein Nachweis-Fehler erreicht diese Stelle nur, wenn der eine Lösungsversuch schon
    // gelaufen ist oder kein Löser da war (`adminLogin`). Erneut rechnen hilft dann nicht.
    case 428:
      return { kind: 'proof-failed' }
    case 429:
    case 503: {
      const retryAfter = readRetryAfter(e.data)
      return { kind: e.code === 429 ? 'rate-limited' : 'unavailable', ...(retryAfter ? { retryAfter } : {}) }
    }
    default:
      return null
  }
}

/**
 * Verlangt die Cloud einen Login-Nachweis (428 `LoginProofRequired`, panary/panary-cloud#1299)?
 * Liefert dann die frische Challenge aus `data.challenge`, sonst `null`. Lokale Fassung von
 * `loginProofDemandOf` aus panary-cloud (`auth.logic.ts`), aus demselben Grund wie oben.
 */
export const loginProofChallengeOf = (error: unknown): LoginProofChallenge | null => {
  const e = (error ?? {}) as { code?: unknown; className?: unknown; data?: unknown }
  if (e.code !== 428 && e.className !== 'login-proof-required') return null
  const challenge = (e.data as { challenge?: unknown } | null | undefined)?.challenge as LoginProofChallenge | undefined
  if (
    !challenge ||
    typeof challenge !== 'object' ||
    !challenge.parameters ||
    typeof challenge.parameters !== 'object'
  ) {
    return null
  }
  return challenge
}
