// Bediener-Token am POS (panary/panary-core#619, ADR 0053, Schritt 3).
// Speicher und `withPosOperatorToken` sind die eine Stelle, ueber die jeder
// schreibende Aufruf sein Token bekommt — `BaseService`, der Outbox-Nachversand
// und der Storno nach Manager-PIN.
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearPosOperatorToken,
  currentPosOperatorToken,
  POS_OPERATOR_TOKEN_STORAGE_KEY,
  posOperatorParams,
  posOperatorTokenOf,
  storePosOperatorToken,
  withPosOperatorToken,
} from './pos-operator-token'

const NOW = Date.parse('2026-10-05T12:00:00.000Z')
const LATER = '2026-10-05T20:00:00.000Z'
const EARLIER = '2026-10-05T11:00:00.000Z'

/** Je Test ein eigener Speicher (testing.md §10). */
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
  return store
}

const stored = (token: string, expiresAt: string) => ({
  [POS_OPERATOR_TOKEN_STORAGE_KEY]: JSON.stringify({ operatorToken: token, operatorTokenExpiresAt: expiresAt }),
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storePosOperatorToken', () => {
  it('uebernimmt Token und Ablaufzeit aus dem verifyPin-Ergebnis', () => {
    const store = stubStorage()

    storePosOperatorToken({ _id: 'u-1', operatorToken: 'tok-1', operatorTokenExpiresAt: LATER })

    expect(JSON.parse(store.get(POS_OPERATOR_TOKEN_STORAGE_KEY) as string)).toEqual({
      operatorToken: 'tok-1',
      operatorTokenExpiresAt: LATER,
    })
  })

  it('entfernt das Token des vorigen Bedieners, wenn das neue Ergebnis keines traegt', () => {
    // Sonst rechnete der Edge die Handlungen des neuen Bedieners dem alten zu.
    const store = stubStorage(stored('tok-alt', LATER))

    storePosOperatorToken({ _id: 'u-2' })

    expect(store.has(POS_OPERATOR_TOKEN_STORAGE_KEY)).toBe(false)
  })
})

describe('currentPosOperatorToken', () => {
  it('liefert ein noch gueltiges Token', () => {
    stubStorage(stored('tok-1', LATER))

    expect(currentPosOperatorToken(NOW)).toBe('tok-1')
  })

  it('liefert kein abgelaufenes Token', () => {
    stubStorage(stored('tok-1', EARLIER))

    expect(currentPosOperatorToken(NOW)).toBeNull()
  })

  it('liefert nach clearPosOperatorToken nichts mehr', () => {
    stubStorage(stored('tok-1', LATER))

    clearPosOperatorToken()

    expect(currentPosOperatorToken(NOW)).toBeNull()
  })
})

describe('withPosOperatorToken', () => {
  it('haengt das Token an die Query und behaelt die uebrigen Parameter', () => {
    expect(withPosOperatorToken({ query: { status: 'OPEN' }, headers: { a: '1' } }, 'tok-1')).toEqual({
      query: { status: 'OPEN', operatorToken: 'tok-1' },
      headers: { a: '1' },
    })
  })

  it('laesst ein vom Aufrufer gesetztes Token stehen (Storno nach Manager-PIN)', () => {
    expect(withPosOperatorToken({ query: { operatorToken: 'tok-manager' } }, 'tok-kassierer')).toEqual({
      query: { operatorToken: 'tok-manager' },
    })
  })

  it('`operatorToken: null` heisst ausdruecklich keines: Schluessel weg, nichts ergaenzt', () => {
    expect(withPosOperatorToken(posOperatorParams(null), 'tok-kassierer')).toEqual({ query: {} })
  })

  it('ohne Token bleiben die Parameter unveraendert', () => {
    expect(withPosOperatorToken({}, null)).toEqual({})
  })
})

describe('posOperatorTokenOf', () => {
  it('liest das Token aus der Query, ignoriert null', () => {
    expect(posOperatorTokenOf({ query: { operatorToken: 'tok-1' } })).toBe('tok-1')
    expect(posOperatorTokenOf(posOperatorParams(null))).toBeNull()
    expect(posOperatorTokenOf(undefined)).toBeNull()
  })
})
