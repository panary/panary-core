import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { tenantAuditTrailDataSchema } from './tenant-audit-trail.schema'
import { TenantAuditAction, TenantAuditSource } from './tenant.enums'

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

/**
 * panary/panary-core#422: Die Cloud schreibt bei der Self-Service-Rücknahme einer
 * Kündigung `CANCEL_WITHDRAWN_SELF_SERVICE`. Fehlt der Wert im Enum, scheitert
 * `validateData` am `enum`-Keyword — und der Audit-Hook schluckt den Fehler still.
 */
describe('tenantAuditTrailDataSchema — action CANCEL_WITHDRAWN_SELF_SERVICE', () => {
  const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
  const validate = getValidator(tenantAuditTrailDataSchema, addFormats(new Ajv({}), formats))

  const auditDoc = (action: string) => ({
    _id: '01920000-0000-7000-8000-000000000001',
    tenantId: '01920000-0000-7000-8000-000000000002',
    actorUserId: '01920000-0000-7000-8000-000000000003',
    actorRole: 'OWNER',
    source: TenantAuditSource.TENANT_OWNER,
    action,
    changedPaths: ['subscription.cancelAtPeriodEnd'],
    beforeDiff: { 'subscription.cancelAtPeriodEnd': true },
    afterDiff: { 'subscription.cancelAtPeriodEnd': false },
    createdAt: '2026-09-28T08:00:00.000Z',
  })

  // Leere Liste = angenommen. Als Liste statt `resolves`, damit ein Fehlschlag das
  // AJV-Keyword nennt — `enum` statt eines anonymen „validation failed".
  async function rejectionKeywords(action: string): Promise<string[]> {
    try {
      await validate(auditDoc(action) as never)
      return []
    } catch (error) {
      return ((error as { errors?: { keyword: string }[] }).errors ?? []).map(e => e.keyword)
    }
  }

  // Das String-Literal, nicht die Konstante: Fehlt der Enum-Eintrag, wäre die Konstante
  // `undefined`, und der Test prüfte ein fehlendes Feld (`required`) statt des Enums.
  it('nimmt die Rücknahme der Kündigung an', async () => {
    expect(TenantAuditAction.CANCEL_WITHDRAWN_SELF_SERVICE).toBe('CANCEL_WITHDRAWN_SELF_SERVICE')
    expect(await rejectionKeywords('CANCEL_WITHDRAWN_SELF_SERVICE')).toEqual([])
  })

  it('lehnt eine unbekannte Aktion am enum-Keyword ab (Gegenprobe)', async () => {
    expect(await rejectionKeywords('CANCEL_UNKNOWN_SELF_SERVICE')).toContain('enum')
  })
})
