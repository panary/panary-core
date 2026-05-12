import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * SHA-256-Hash eines Strings als Hex-String.
 *
 * Verwendet ausschliesslich fuer API-Key-Hashing (Geraete-Credentials).
 * NICHT fuer Passwoerter — dafuer wird bcrypt via @feathersjs/authentication-local
 * eingesetzt (siehe documentation/security-hardening.md).
 *
 * Begruendung fuer SHA-256 (ohne Stretching):
 * - API-Keys sind hoch-entropisch (256+ Bit, kryptografisch zufaellig generiert
 *   in apps/api-edge/src/services/apikeys/apikeys.ts).
 * - Brute-Force gegen einen 256-Bit-Random-Key ist unmoeglich, daher braucht
 *   es keine teure Key-Stretching-Funktion wie Argon2/bcrypt.
 * - Lookup-Pattern (Prefix-Index + Hash-Vergleich) profitiert von der
 *   determinischen Hash-Funktion — Pro Auth-Request 1 SHA-256-Hash + 1
 *   Index-Lookup. Mit bcrypt waere ein Linear-Scan + bcrypt.compare pro
 *   Eintrag noetig (~100x langsamer bei Device-Authentifizierung).
 *
 * CodeQL-Alert js/insufficient-password-hash wird hier bewusst supprimiert,
 * da CodeQL nicht zwischen low-entropy User-Passwoertern und high-entropy
 * Maschinen-Credentials unterscheidet.
 */
// lgtm[js/insufficient-password-hash]
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Timing-Safe Vergleich zweier Hex-Strings.
 * Verhindert Timing-Attacks beim API-Key-Abgleich.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}
