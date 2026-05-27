import { describe, expect, it } from 'vitest'

import { resolveTseProvider } from './tse-provider'
import { TseError } from './tse.errors'

describe('resolveTseProvider', () => {
  it('Default in Nicht-Produktion = simulator', () => {
    expect(resolveTseProvider(undefined, false)).toBe('simulator')
  })

  it('In Produktion ohne Konfiguration = inaktiv (undefined) — bricht Bestands-Deployments nicht', () => {
    expect(resolveTseProvider(undefined, true)).toBeUndefined()
  })

  it('Explizit simulator in Produktion → wirft (fail-closed)', () => {
    expect(() => resolveTseProvider('simulator', true)).toThrow(TseError)
  })

  it('Explizit simulator in Nicht-Produktion → simulator', () => {
    expect(resolveTseProvider('simulator', false)).toBe('simulator')
  })

  it('fiskaly wird durchgereicht (Adapter folgt in eigener Phase)', () => {
    expect(resolveTseProvider('fiskaly', true)).toBe('fiskaly')
  })

  it('Unbekannter Provider → wirft', () => {
    expect(() => resolveTseProvider('bogus', false)).toThrow(TseError)
  })
})
