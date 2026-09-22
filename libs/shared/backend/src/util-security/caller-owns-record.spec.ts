import { describe, expect, it } from 'vitest'

import { assertCallerOwnsRecord, checkCallerOwnsRecord } from './caller-owns-record'

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'

describe('checkCallerOwnsRecord (#357)', () => {
  describe('durchlassen', () => {
    it('laesst interne Aufrufe ohne Aufrufer durch', () => {
      // Sync, Seed, Migration und Worker rufen mit `{ provider: undefined }` auf
      // und tragen keinen User. Sie hier abzuweisen legte den Server lahm.
      expect(checkCallerOwnsRecord(undefined, { tenantId: TENANT_B })).toBeNull()
      expect(checkCallerOwnsRecord(null, { tenantId: TENANT_B })).toBeNull()
    })

    it('laesst Plattform-Rollen mandantenuebergreifend durch', () => {
      for (const role of ['platform:owner', 'platform:admin', 'platform:support']) {
        expect(checkCallerOwnsRecord({ role, tenantId: undefined }, { tenantId: TENANT_B }), role).toBeNull()
      }
    })

    it('laesst den eigenen Mandanten durch', () => {
      expect(checkCallerOwnsRecord({ role: 'tenant:staff', tenantId: TENANT_A }, { tenantId: TENANT_A })).toBeNull()
    })
  })

  describe('abweisen', () => {
    it('weist einen fremden Mandanten ab', () => {
      const v = checkCallerOwnsRecord({ role: 'tenant:staff', tenantId: TENANT_A }, { tenantId: TENANT_B })

      expect(v?.reason).toBe('FOREIGN_TENANT')
    })

    // 🚨 Der Fall, den ALLE drei Vorgaengerfassungen durchliessen. Sie schrieben
    // `if (actor.tenantId && …)` und prueften damit genau dann nicht, wenn der
    // Mandantenkontext fehlte — also im unklarsten Fall. Faellt dieser Test,
    // wurde der Helfer auf die bedingte Form zurueckgedreht.
    it('weist einen Aufrufer OHNE tenantId ab, statt ihn durchzulassen', () => {
      for (const actor of [
        { role: 'tenant:staff' },
        { role: 'tenant:staff', tenantId: null },
        { role: 'tenant:staff', tenantId: '' },
        { role: 'device:pos-client', tenantId: undefined },
      ]) {
        const v = checkCallerOwnsRecord(actor, { tenantId: TENANT_B })
        expect(v?.reason, JSON.stringify(actor)).toBe('NO_TENANT_CONTEXT')
      }
    })

    it('laesst einen Aufrufer ohne tenantId NUR mit der benannten Ausnahme durch', () => {
      // Der virtuelle Geraete-User vor dem Pairing — die einzige bekannte
      // legitime Konstellation ohne Mandant (time-clock-scope.spec.ts).
      const vorPairing = { _id: 'device:dev-1', role: 'device:pos-client' }

      expect(checkCallerOwnsRecord(vorPairing, { tenantId: TENANT_B })?.reason).toBe('NO_TENANT_CONTEXT')
      expect(checkCallerOwnsRecord(vorPairing, { tenantId: TENANT_B }, { allowMissingTenantContext: true })).toBeNull()
    })

    it('die Ausnahme hebelt den Mandanten-Vergleich NICHT aus', () => {
      // `allowMissingTenantContext` erlaubt einen FEHLENDEN Mandanten, nicht
      // einen falschen. Sonst waere die Option ein Generalschluessel.
      const v = checkCallerOwnsRecord(
        { role: 'device:pos-client', tenantId: TENANT_A },
        { tenantId: TENANT_B },
        { allowMissingTenantContext: true },
      )

      expect(v?.reason).toBe('FOREIGN_TENANT')
    })

    it('weist ab, wenn der Datensatz gar keinen Mandanten traegt', () => {
      // Ein Ziel ohne `tenantId` ist nicht „gehoert allen", sondern unbestimmt.
      for (const target of [undefined, null, {}, { tenantId: null }]) {
        const v = checkCallerOwnsRecord({ role: 'tenant:staff', tenantId: TENANT_A }, target)
        expect(v?.reason, JSON.stringify(target)).toBe('FOREIGN_TENANT')
      }
    })

    it('laesst eine Rolle, die nur wie eine Plattform-Rolle AUSSIEHT, nicht durch', () => {
      // `startsWith('platform:')` ist die Regel — ein Name, der das Wort nur
      // enthaelt, darf den Bypass nicht ausloesen.
      for (const role of ['tenant:platform-admin', 'PLATFORM:owner', 'xplatform:owner']) {
        const v = checkCallerOwnsRecord({ role, tenantId: TENANT_A }, { tenantId: TENANT_B })
        expect(v?.reason, role).toBe('FOREIGN_TENANT')
      }
    })
  })
})

describe('assertCallerOwnsRecord (#357)', () => {
  it('wirft Forbidden (403) mit dem Grund im Fehler', () => {
    try {
      assertCallerOwnsRecord({ role: 'tenant:staff', tenantId: TENANT_A }, { tenantId: TENANT_B })
      expect.unreachable('haette werfen muessen')
    } catch (err) {
      const e = err as { code?: number; name?: string; data?: { reason?: string } }
      expect(e.code).toBe(403)
      expect(e.name).toBe('Forbidden')
      expect(e.data?.reason).toBe('FOREIGN_TENANT')
    }
  })

  it('wirft nicht, wenn der Mandant passt', () => {
    expect(() =>
      assertCallerOwnsRecord({ role: 'tenant:staff', tenantId: TENANT_A }, { tenantId: TENANT_A }),
    ).not.toThrow()
  })
})
