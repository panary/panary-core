import { describe, expect, it } from 'vitest'

import { edgeTenantDataSchema, edgeTenantSchema } from './edge-tenant.schema'

// Formats (`uuid`/`date-time`) werden erst im Feathers-getValidator via AJV
// aufgeloest — daher struktur-basierte Assertions (format-unabhaengig), die
// die Sync-kritischen Eigenschaften des Schemas festnageln.
describe('edgeTenantSchema', () => {
  const props = edgeTenantSchema.properties as Record<string, any>

  it('traegt KEINE tenantId-/locationId-Felder — das _id IST der Tenant', () => {
    expect(props['tenantId']).toBeUndefined()
    expect(props['locationId']).toBeUndefined()
  })

  it('enthaelt keine Cloud-only-Aggregate (Allowlist-Projection-Kontrakt)', () => {
    for (const cloudOnly of ['subscription', 'billing', 'securityPolicy', 'compliance', 'internalNotes', 'sso']) {
      expect(props[cloudOnly]).toBeUndefined()
    }
  })

  it('koppelt status/tse.provider NICHT an Cloud-Enums (neue Werte duerfen den Pull nicht brechen)', () => {
    expect(props['status'].enum).toBeUndefined()
    expect(props['status'].anyOf).toBeUndefined()
    const tseProps = props['tse'].properties as Record<string, any>
    expect(tseProps['provider'].enum).toBeUndefined()
    expect(tseProps['provider'].anyOf).toBeUndefined()
  })

  it('bleibt additionalProperties: false (kein Wildcard-Passthrough)', () => {
    expect(edgeTenantSchema.additionalProperties).toBe(false)
  })
})

describe('edgeTenantDataSchema', () => {
  const props = edgeTenantDataSchema.properties as Record<string, unknown>
  const required = (edgeTenantDataSchema.required ?? []) as string[]

  it('erlaubt _id/updatedAt optional — Sync-CREATEs bringen sie mit (Muster locationDataSchema)', () => {
    expect(props['_id']).toBeDefined()
    expect(props['updatedAt']).toBeDefined()
    expect(required).not.toContain('_id')
    expect(required).not.toContain('updatedAt')
  })

  it('verlangt name als einziges Pflichtfeld der Projection', () => {
    expect(required).toContain('name')
  })

  it('bleibt additionalProperties: false', () => {
    expect(edgeTenantDataSchema.additionalProperties).toBe(false)
  })
})
