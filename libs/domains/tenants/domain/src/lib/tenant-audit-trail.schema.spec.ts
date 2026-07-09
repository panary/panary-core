import { describe, expect, it } from 'vitest'

import { tenantAuditTrailDataSchema } from './tenant-audit-trail.schema'

// Regression: Das Data-Schema war zuvor `Type.Omit([_id, createdAt])` +
// additionalProperties:false. Der Backend-Hook
// (apps/api-cloud/src/hooks/tenant-audit-trail.hook.ts) liefert `_id` +
// `createdAt` aber EXPLIZIT mit (Konsistenz mit audit-events; der Data-Resolver
// setzt keine Server-Defaults) → validateData verwarf jeden auditDoc als
// „additional property", und JEDER Audit-Write ging still verloren
// (Hook-try/catch). Der Fix nimmt beide Felder wieder ins Data-Schema auf.
//
// Formats (`uuid`/`date-time`) werden erst im Feathers-getValidator via AJV
// aufgeloest — daher hier struktur-basierte Assertions (format-unabhaengig),
// die exakt die geaenderte Eigenschaft prüfen (Omit → enthalten + required).
describe('tenantAuditTrailDataSchema', () => {
  const props = tenantAuditTrailDataSchema.properties as Record<string, unknown>
  const required = (tenantAuditTrailDataSchema.required ?? []) as string[]

  it('enthält _id im Data-Schema (war durch Omit entfernt)', () => {
    expect(props['_id']).toBeDefined()
    expect(required).toContain('_id')
  })

  it('enthält createdAt im Data-Schema (war durch Omit entfernt)', () => {
    expect(props['createdAt']).toBeDefined()
    expect(required).toContain('createdAt')
  })

  it('bleibt additionalProperties: false (kein Wildcard-Passthrough)', () => {
    expect(tenantAuditTrailDataSchema.additionalProperties).toBe(false)
  })

  it('behält die Kern-Audit-Felder (tenantId, action, source, changedPaths)', () => {
    for (const field of ['tenantId', 'action', 'source', 'changedPaths']) {
      expect(props[field]).toBeDefined()
    }
  })
})
