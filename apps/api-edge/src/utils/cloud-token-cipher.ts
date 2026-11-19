import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Verschluesselt den `cloudToken` at-rest in SQLite.
 *
 * Format: `enc:v1:<iv-hex>:<ciphertext-hex>:<tag-hex>`. Bestehende
 * Klartext-Tokens werden beim Lesen erkannt (kein `enc:`-Prefix) und
 * unveraendert zurueckgegeben — das ermoeglicht eine Migration ohne
 * Force-Re-Pair, weil die Token beim naechsten Heartbeat-Rotation-Cycle
 * automatisch verschluesselt nachgespeichert werden.
 *
 * Master-Key kommt aus `EDGE_TOKEN_ENCRYPTION_KEY` (env). Mindestens
 * 32 Zeichen empfohlen — wird via SHA-256 auf 32 Bytes (AES-256) abgeleitet.
 * Fehlt der Key, gibt der Cipher einen No-Op zurueck und loggt eine
 * Warnung, damit Dev-Setups nicht hart brechen. Der Boot meldet den Zustand
 * zusaetzlich laut (`cloud-token-boot-migration.ts`, panary/panary-core#1498).
 */

const ENCRYPTION_PREFIX = 'enc:v1:'
const ALGORITHM = 'aes-256-gcm' as const
const IV_BYTES = 12

/** Der Cipher akzeptiert Schluessel ab 8 Zeichen; der Installer erzeugt 44. */
export const TOKEN_KEY_MIN_LENGTH = 8
/** Empfohlene Mindestlaenge — darunter gilt der Schluessel als schwach, wird aber nie ersetzt. */
export const TOKEN_KEY_RECOMMENDED_LENGTH = 32

let cachedKey: Buffer | null = null
let warnedMissingKey = false

export type TokenKeyStatus = 'missing' | 'weak' | 'ok'

/**
 * Zustand des Schluessels in der Umgebung, ohne Cache und ohne Warnung — der
 * Boot braucht die Unterscheidung `weak` (8–31 Zeichen) von `ok`, der Cipher
 * selbst nicht. Der Wert wird nie zurueckgegeben, nur seine Laenge bewertet.
 */
export const getTokenKeyStatus = (): { status: TokenKeyStatus; length: number } => {
  const raw = process.env['EDGE_TOKEN_ENCRYPTION_KEY']
  const length = typeof raw === 'string' ? raw.length : 0
  if (length < TOKEN_KEY_MIN_LENGTH) return { status: 'missing', length }
  return { status: length < TOKEN_KEY_RECOMMENDED_LENGTH ? 'weak' : 'ok', length }
}

const deriveKey = (): Buffer | null => {
  if (cachedKey) return cachedKey
  const raw = process.env['EDGE_TOKEN_ENCRYPTION_KEY']
  if (typeof raw !== 'string' || raw.length < TOKEN_KEY_MIN_LENGTH) {
    if (!warnedMissingKey) {
      // eslint-disable-next-line no-console
      console.warn(
        '[cloud-token-cipher] EDGE_TOKEN_ENCRYPTION_KEY nicht gesetzt — cloudToken wird im Klartext gespeichert (nicht fuer Produktion!).',
      )
      warnedMissingKey = true
    }
    return null
  }
  cachedKey = createHash('sha256').update(raw, 'utf8').digest()
  return cachedKey
}

/** NUR fuer Tests — entfernt den gecachten Key. */
export const __resetCloudTokenCipherCache = () => {
  cachedKey = null
  warnedMissingKey = false
}

export const isEncryptedToken = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.startsWith(ENCRYPTION_PREFIX)

export const encryptCloudToken = (plaintext: string): string => {
  if (!plaintext) return plaintext
  if (isEncryptedToken(plaintext)) return plaintext
  const key = deriveKey()
  if (!key) return plaintext

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENCRYPTION_PREFIX}${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`
}

export const decryptCloudToken = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string' || value.length === 0) return null
  if (!isEncryptedToken(value)) {
    // Klartext-Fallback fuer Migration (alter Datensatz vor F6).
    return value
  }
  const key = deriveKey()
  if (!key) {
    throw new Error('cloudToken ist verschluesselt gespeichert, aber EDGE_TOKEN_ENCRYPTION_KEY fehlt.')
  }
  const body = value.slice(ENCRYPTION_PREFIX.length)
  const parts = body.split(':')
  if (parts.length !== 3) throw new Error('cloudToken-Format unguelig.')
  const [ivHex, cipherHex, tagHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const cipherText = Buffer.from(cipherHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  // authTagLength: 16 explizit setzen — verhindert, dass ein gekürzter Auth-Tag
  // akzeptiert wird (GCM-Forgery-Schutz). Encrypt-Seite nutzt getAuthTag()
  // (Default 16 Byte), bestehende Ciphertexte bleiben damit kompatibel.
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 })
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()])
  return decrypted.toString('utf8')
}
