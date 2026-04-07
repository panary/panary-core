import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * SHA-256-Hash eines Strings als Hex-String.
 * Verwendet für API-Key-Hashing (nicht für Passwörter — dafür bcrypt nutzen).
 */
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
