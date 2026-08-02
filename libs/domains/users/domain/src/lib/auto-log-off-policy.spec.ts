import { describe, expect, it } from 'vitest'
import { isAutoLogOffEnabled } from './auto-log-off-policy'

describe('isAutoLogOffEnabled', () => {
  it('aktiviert den Auto-Logoff, wenn das Feld fehlt (Schema-Default true)', () => {
    expect(isAutoLogOffEnabled({})).toBe(true)
    expect(isAutoLogOffEnabled({ autoLogOff: undefined })).toBe(true)
    expect(isAutoLogOffEnabled({ autoLogOff: null })).toBe(true)
  })

  it('aktiviert den Auto-Logoff bei fehlendem Sitzungs-Record (fail-secure)', () => {
    expect(isAutoLogOffEnabled(null)).toBe(true)
    expect(isAutoLogOffEnabled(undefined)).toBe(true)
  })

  it('liest SQLite-Booleans (0/1) korrekt', () => {
    expect(isAutoLogOffEnabled({ autoLogOff: 1 })).toBe(true)
    expect(isAutoLogOffEnabled({ autoLogOff: 0 })).toBe(false)
  })

  it('liest durchgereichte String-Werte korrekt', () => {
    expect(isAutoLogOffEnabled({ autoLogOff: '0' })).toBe(false)
    expect(isAutoLogOffEnabled({ autoLogOff: 'false' })).toBe(false)
    expect(isAutoLogOffEnabled({ autoLogOff: '1' })).toBe(true)
    expect(isAutoLogOffEnabled({ autoLogOff: 'true' })).toBe(true)
  })

  it('reicht echte Booleans durch', () => {
    expect(isAutoLogOffEnabled({ autoLogOff: true })).toBe(true)
    expect(isAutoLogOffEnabled({ autoLogOff: false })).toBe(false)
  })
})
