import { describe, expect, it } from 'vitest'
import {
  cloudEdgePatchSchema,
  cloudEdgeSchema,
  EdgeProvenance,
  EdgeTrustTier,
} from './cloud-edge.schema'

describe('cloudEdgeSchema — Provenienz/Trust', () => {
  it('exportiert die zwei Provenienz-Werte', () => {
    expect(Object.values(EdgeProvenance)).toEqual(['panary-managed', 'tenant-self-managed'])
  })

  it('exportiert die drei Trust-Tier-Werte', () => {
    expect(Object.values(EdgeTrustTier)).toEqual([
      'crypto-verified',
      'provenance-verified',
      'unverified',
    ])
  })

  it('fuehrt provenance/trustTier/Audit-Felder als optionale Properties', () => {
    const props = (cloudEdgeSchema as { properties: Record<string, unknown> }).properties
    expect(props).toHaveProperty('provenance')
    expect(props).toHaveProperty('trustTier')
    expect(props).toHaveProperty('provenanceSetByUserId')
    expect(props).toHaveProperty('provenanceSetAt')

    const required = (cloudEdgeSchema as { required?: string[] }).required ?? []
    expect(required).not.toContain('provenance')
    expect(required).not.toContain('trustTier')
  })

  it('bleibt additionalProperties:false', () => {
    expect((cloudEdgeSchema as { additionalProperties?: boolean }).additionalProperties).toBe(false)
  })

  it('erlaubt provenance im Patch-Schema, aber NICHT trustTier/Audit-Felder', () => {
    const patchProps = (cloudEdgePatchSchema as { properties: Record<string, unknown> }).properties
    // provenance muss whitelisted sein, damit der Platform-Patch den Validator passiert.
    expect(patchProps).toHaveProperty('provenance')
    // trustTier + Audit sind server-only (protectFromExternal) — nie patchbar.
    expect(patchProps).not.toHaveProperty('trustTier')
    expect(patchProps).not.toHaveProperty('provenanceSetByUserId')
    expect(patchProps).not.toHaveProperty('provenanceSetAt')
  })
})
