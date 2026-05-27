import { describe, expect, it } from 'vitest'

import { resolveTseProvider, tseProviderFromTenant } from './tse-provider'
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

describe('tseProviderFromTenant', () => {
  it('FISKALY → fiskaly', () => {
    expect(tseProviderFromTenant('FISKALY')).toBe('fiskaly')
  })

  it('Noch nicht adaptierte Provider → undefined (Fallback auf Config/Simulator)', () => {
    expect(tseProviderFromTenant('SWISSBIT')).toBeUndefined()
    expect(tseProviderFromTenant('EPSON')).toBeUndefined()
    expect(tseProviderFromTenant('OTHER')).toBeUndefined()
  })

  it('undefined/null → undefined', () => {
    expect(tseProviderFromTenant(undefined)).toBeUndefined()
    expect(tseProviderFromTenant(null)).toBeUndefined()
  })
})
