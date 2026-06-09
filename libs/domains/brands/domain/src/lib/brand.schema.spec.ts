import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'

import { brandDataSchema, brandPatchSchema, brandSchema, customDomainSchema } from './brand.schema'

const validBrand = {
  _id: '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7e1',
  tenantId: '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7e2',
  name: 'Burger Heaven',
  handle: 'burger-heaven',
  branding: {
    logoUrl: 'https://cdn.example.com/logo.webp',
    primaryColor: '#1a73e8',
  },
  customDomains: [],
  createdAt: '2026-06-08T10:00:00.000Z',
  updatedAt: '2026-06-08T10:00:00.000Z',
}

describe('brandSchema', () => {
  it('akzeptiert ein vollständiges Brand-Objekt', () => {
    expect(Value.Check(brandSchema, validBrand)).toBe(true)
  })

  it('lehnt ab, wenn tenantId fehlt', () => {
    const { tenantId: _omitted, ...withoutTenant } = validBrand
    expect(Value.Check(brandSchema, withoutTenant)).toBe(false)
  })

  it('lehnt handle mit Uppercase ab (Pattern ^[a-z0-9-]+$)', () => {
    expect(Value.Check(brandSchema, { ...validBrand, handle: 'Burger-Heaven' })).toBe(false)
  })

  it('lehnt zusätzliche Top-Level-Properties ab (additionalProperties: false)', () => {
    expect(Value.Check(brandSchema, { ...validBrand, foo: 'bar' })).toBe(false)
  })

  it('akzeptiert Brand ohne optionales branding-Feld', () => {
    const { branding: _omitted, ...withoutBranding } = validBrand
    expect(Value.Check(brandSchema, withoutBranding)).toBe(true)
  })

  it('lehnt branding.primaryColor ab, wenn nicht im 6-stelligen Hex-Pattern', () => {
    expect(
      Value.Check(brandSchema, { ...validBrand, branding: { primaryColor: 'not-a-color' } }),
    ).toBe(false)
  })
})

describe('brandDataSchema', () => {
  it('akzeptiert valide Create-Daten ohne _id/createdAt/updatedAt', () => {
    const { _id: _i, createdAt: _c, updatedAt: _u, ...createData } = validBrand
    expect(Value.Check(brandDataSchema, createData)).toBe(true)
  })

  it('lehnt Create-Daten mit _id ab (additionalProperties:false durch Type.Omit)', () => {
    const { createdAt: _c, updatedAt: _u, ...withId } = validBrand
    expect(Value.Check(brandDataSchema, withId)).toBe(false)
  })
})

describe('brandPatchSchema', () => {
  it('akzeptiert ein partielles Patch-Objekt', () => {
    expect(Value.Check(brandPatchSchema, { name: 'Neuer Name' })).toBe(true)
  })

  it('akzeptiert ein leeres Patch-Objekt', () => {
    expect(Value.Check(brandPatchSchema, {})).toBe(true)
  })
})

//#region Phase 7 — DOM-01 + DOM-02 + D-26
// RED-Erwartung: customDomainSchema fehlt heute → Import schlägt fehl.
// Task 2 macht GREEN (Sub-Aggregat + customDomains:CustomDomain[] + defaultLocationId).

describe('customDomainSchema (Phase 7 D-01)', () => {
  const validCustomDomain = {
    hostname: 'restaurant.de',
    status: 'pending' as const,
    verificationToken: '0190a000-0000-7000-8000-000000000001',
  }

  it('akzeptiert ein gültiges CustomDomain-Objekt', () => {
    expect(Value.Check(customDomainSchema, validCustomDomain)).toBe(true)
  })

  it('akzeptiert eine Subdomain (sub.restaurant.de)', () => {
    expect(Value.Check(customDomainSchema, { ...validCustomDomain, hostname: 'sub.restaurant.de' })).toBe(true)
  })

  it('akzeptiert eine Punycode-Domain (xn--bcher-kva.de)', () => {
    expect(Value.Check(customDomainSchema, { ...validCustomDomain, hostname: 'xn--bcher-kva.de' })).toBe(true)
  })

  it('lehnt Uppercase-Hostname ab', () => {
    expect(Value.Check(customDomainSchema, { ...validCustomDomain, hostname: 'Restaurant.de' })).toBe(false)
  })

  it('lehnt Hostname mit Protokoll-Prefix ab', () => {
    expect(
      Value.Check(customDomainSchema, { ...validCustomDomain, hostname: 'https://restaurant.de' }),
    ).toBe(false)
  })

  it('lehnt Hostname mit Trailing-Dot ab', () => {
    expect(Value.Check(customDomainSchema, { ...validCustomDomain, hostname: 'restaurant.de.' })).toBe(false)
  })

  it('lehnt Hostname mit Port ab', () => {
    expect(
      Value.Check(customDomainSchema, { ...validCustomDomain, hostname: 'restaurant.de:8080' }),
    ).toBe(false)
  })

  it('lehnt unbekannten status-Wert ab', () => {
    expect(Value.Check(customDomainSchema, { ...validCustomDomain, status: 'unknown' })).toBe(false)
  })

  it('akzeptiert alle vier status-Werte (pending|verified|active|failed)', () => {
    for (const status of ['pending', 'verified', 'active', 'failed'] as const) {
      expect(Value.Check(customDomainSchema, { ...validCustomDomain, status })).toBe(true)
    }
  })

  it('lehnt zusätzliche Felder ab (additionalProperties:false)', () => {
    expect(
      Value.Check(customDomainSchema, { ...validCustomDomain, extra: 'foo' }),
    ).toBe(false)
  })

  it('akzeptiert optionale Timestamps (verifiedAt/activatedAt/lastCheckAt) + failureReason', () => {
    const full = {
      hostname: 'restaurant.de',
      status: 'active' as const,
      verificationToken: '0190a000-0000-7000-8000-000000000001',
      verifiedAt: '2026-06-09T12:00:00.000Z',
      activatedAt: '2026-06-09T12:05:00.000Z',
      lastCheckAt: '2026-06-09T12:00:00.000Z',
      failureReason: 'NXDOMAIN — TXT-Record nicht gefunden',
    }
    expect(Value.Check(customDomainSchema, full)).toBe(true)
  })

  it('lehnt zu langes failureReason ab (maxLength 500)', () => {
    const longReason = 'x'.repeat(501)
    expect(
      Value.Check(customDomainSchema, { ...validCustomDomain, failureReason: longReason }),
    ).toBe(false)
  })
})

describe('brandSchema customDomains + defaultLocationId (Phase 7 D-01/D-26)', () => {
  const baseBrand = {
    _id: '0190a000-0000-7000-8000-000000000001',
    tenantId: '0190a000-0000-7000-8000-000000000002',
    name: 'Burgerheaven',
    handle: 'burgerheaven',
    createdAt: '2026-06-09T12:00:00.000Z',
    updatedAt: '2026-06-09T12:00:00.000Z',
  }

  it('akzeptiert leeres customDomains-Array (Backward-Kompat Phase-6-Stub)', () => {
    const brand = { ...baseBrand, customDomains: [] }
    expect(Value.Check(brandSchema, brand)).toBe(true)
  })

  it('akzeptiert CustomDomain[] (nicht mehr string[])', () => {
    const brand = {
      ...baseBrand,
      customDomains: [
        {
          hostname: 'restaurant.de',
          status: 'pending' as const,
          verificationToken: '0190a000-0000-7000-8000-000000000003',
        },
      ],
    }
    expect(Value.Check(brandSchema, brand)).toBe(true)
  })

  it('lehnt customDomains als string[] ab (Phase-6-Stub ist abgelöst)', () => {
    const brand = { ...baseBrand, customDomains: ['restaurant.de'] }
    expect(Value.Check(brandSchema, brand)).toBe(false)
  })

  it('akzeptiert defaultLocationId optional (fehlend + uuidv7-String beide gültig)', () => {
    const without = { ...baseBrand, customDomains: [] }
    const withId = {
      ...baseBrand,
      customDomains: [],
      defaultLocationId: '0190a000-0000-7000-8000-000000000004',
    }
    expect(Value.Check(brandSchema, without)).toBe(true)
    expect(Value.Check(brandSchema, withId)).toBe(true)
  })

  it('erzwingt maxItems:20 für customDomains', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      hostname: `domain${i}.de`,
      status: 'pending' as const,
      verificationToken: `0190a000-0000-7000-8000-00000000${String(i).padStart(4, '0')}`,
    }))
    const brand = { ...baseBrand, customDomains: tooMany }
    expect(Value.Check(brandSchema, brand)).toBe(false)
  })
})

describe('brandPatchSchema customDomains + defaultLocationId (Phase 7 D-01/D-26)', () => {
  it('akzeptiert customDomains-Patch mit CustomDomain[]', () => {
    const patch = {
      customDomains: [
        {
          hostname: 'neu.de',
          status: 'pending' as const,
          verificationToken: '0190a000-0000-7000-8000-000000000005',
        },
      ],
    }
    expect(Value.Check(brandPatchSchema, patch)).toBe(true)
  })

  it('akzeptiert defaultLocationId-Patch', () => {
    const patch = { defaultLocationId: '0190a000-0000-7000-8000-000000000006' }
    expect(Value.Check(brandPatchSchema, patch)).toBe(true)
  })
})
//#endregion
