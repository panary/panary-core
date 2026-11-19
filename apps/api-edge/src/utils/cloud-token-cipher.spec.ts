import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetCloudTokenCipherCache,
  decryptCloudToken,
  encryptCloudToken,
  getTokenKeyStatus,
  isEncryptedToken,
} from './cloud-token-cipher'

const KEY = 'vitest-token-key-0123456789abcdef-not-a-secret'
const OTHER_KEY = 'vitest-other-key-0123456789abcdef-not-a-secret'

describe('cloud-token-cipher', () => {
  const original = process.env['EDGE_TOKEN_ENCRYPTION_KEY']

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    __resetCloudTokenCipherCache()
  })

  afterEach(() => {
    if (original === undefined) delete process.env['EDGE_TOKEN_ENCRYPTION_KEY']
    else process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = original
    __resetCloudTokenCipherCache()
    vi.restoreAllMocks()
  })

  describe('mit Schluessel', () => {
    beforeEach(() => {
      process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = KEY
    })

    it('verschluesselt mit enc:v1-Prefix und entschluesselt zurueck', () => {
      const encrypted = encryptCloudToken('jwt-token')
      expect(encrypted.startsWith('enc:v1:')).toBe(true)
      expect(encrypted).not.toContain('jwt-token')
      expect(decryptCloudToken(encrypted)).toBe('jwt-token')
    })

    it('verschluesselt einen bereits verschluesselten Wert nicht doppelt', () => {
      const encrypted = encryptCloudToken('jwt-token')
      expect(encryptCloudToken(encrypted)).toBe(encrypted)
    })

    it('liefert je Aufruf einen anderen Ciphertext (zufaelliger IV)', () => {
      expect(encryptCloudToken('jwt-token')).not.toBe(encryptCloudToken('jwt-token'))
    })

    it('reicht einen Klartext-Token beim Lesen unveraendert durch', () => {
      expect(decryptCloudToken('plain-token')).toBe('plain-token')
    })

    it('verweigert einen mit anderem Schluessel verschluesselten Token', () => {
      const encrypted = encryptCloudToken('jwt-token')
      process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = OTHER_KEY
      __resetCloudTokenCipherCache()
      expect(() => decryptCloudToken(encrypted)).toThrow()
    })

    it('verweigert einen manipulierten Ciphertext', () => {
      const [iv, cipher, tag] = encryptCloudToken('jwt-token').slice('enc:v1:'.length).split(':')
      const flipped = cipher.startsWith('0') ? `1${cipher.slice(1)}` : `0${cipher.slice(1)}`
      expect(() => decryptCloudToken(`enc:v1:${iv}:${flipped}:${tag}`)).toThrow()
    })
  })

  describe('ohne Schluessel', () => {
    beforeEach(() => {
      delete process.env['EDGE_TOKEN_ENCRYPTION_KEY']
    })

    it('laesst den Klartext stehen (No-op) und warnt', () => {
      expect(encryptCloudToken('jwt-token')).toBe('jwt-token')
      expect(console.warn).toHaveBeenCalledTimes(1)
    })

    it('wirft beim Lesen eines verschluesselten Tokens', () => {
      process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = KEY
      const encrypted = encryptCloudToken('jwt-token')
      delete process.env['EDGE_TOKEN_ENCRYPTION_KEY']
      __resetCloudTokenCipherCache()
      expect(() => decryptCloudToken(encrypted)).toThrow(/EDGE_TOKEN_ENCRYPTION_KEY fehlt/)
    })
  })

  describe('getTokenKeyStatus', () => {
    it('unterscheidet fehlend, schwach und ausreichend — ohne den Wert preiszugeben', () => {
      delete process.env['EDGE_TOKEN_ENCRYPTION_KEY']
      expect(getTokenKeyStatus()).toEqual({ status: 'missing', length: 0 })
      process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = '1234567'
      expect(getTokenKeyStatus().status).toBe('missing')
      process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = '12345678'
      expect(getTokenKeyStatus()).toEqual({ status: 'weak', length: 8 })
      process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = 'x'.repeat(31)
      expect(getTokenKeyStatus().status).toBe('weak')
      process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = 'x'.repeat(32)
      expect(getTokenKeyStatus().status).toBe('ok')
    })
  })

  it('isEncryptedToken erkennt nur den enc:v1-Prefix', () => {
    expect(isEncryptedToken('enc:v1:a:b:c')).toBe(true)
    expect(isEncryptedToken('plain')).toBe(false)
    expect(isEncryptedToken(null)).toBe(false)
  })
})
