import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'

import { brandDataSchema, brandPatchSchema, brandSchema } from './brand.schema'

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
