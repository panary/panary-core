// Entscheidung der Zeiterfassungs-Policy (panary/panary-core#189).
//
// Die Verdrahtung — ruft jede der vier Methoden diese Pruefung ueberhaupt auf? —
// steht bewusst in einer eigenen Spec (time-clock-wiring.spec.ts). Genau dieser
// Fehler war ja der Befund: nicht „die Policy entscheidet falsch", sondern „es
// gibt gar keine".
import { describe, expect, it } from 'vitest'

import { PRIVILEGED_ROLES, UserStatus, UserSystemRole } from '@panary/users/domain'

import { assertTimeClockAccess, checkTimeClockRequest } from './time-clock-scope'

const staff = { _id: 'u-staff', role: UserSystemRole.TENANT_STAFF, tenantId: 't-1' }
const manager = { _id: 'u-manager', role: UserSystemRole.TENANT_MANAGER, tenantId: 't-1' }
const owner = { _id: 'u-owner', role: UserSystemRole.TENANT_OWNER, tenantId: 't-1' }
const device = { _id: 'device:dev-1', role: UserSystemRole.DEVICE_POS, tenantId: 't-1' }

const target = (over: Record<string, unknown> = {}) => ({
  _id: 'u-victim',
  tenantId: 't-1',
  status: UserStatus.ACTIVE,
  ...over,
})

describe('checkTimeClockRequest', () => {
  it('interner Aufruf (kein Actor) → durchlassen', () => {
    expect(checkTimeClockRequest(undefined, target())).toBeNull()
  })

  it('eigener Datensatz → erlaubt', () => {
    expect(checkTimeClockRequest(staff, target({ _id: staff._id }))).toBeNull()
  })

  it('fremder Kollege im eigenen Mandanten → FOREIGN_RECORD', () => {
    expect(checkTimeClockRequest(staff, target())).toMatchObject({ reason: 'FOREIGN_RECORD' })
  })

  it('Geraete-Rolle darf fuer jeden stempeln — ein Terminal bedient die ganze Schicht', () => {
    expect(checkTimeClockRequest(device, target())).toBeNull()
  })

  it('jede PRIVILEGED_ROLE darf fremd stempeln', () => {
    for (const role of PRIVILEGED_ROLES) {
      expect(checkTimeClockRequest({ _id: 'u-priv', role, tenantId: 't-1' }, target())).toBeNull()
    }
  })

  it('TENANT_MANAGER ist NICHT privilegiert — Entscheidung zu #189, konsistent zu changePin', () => {
    expect(PRIVILEGED_ROLES.has(UserSystemRole.TENANT_MANAGER)).toBe(false)
    expect(checkTimeClockRequest(manager, target())).toMatchObject({ reason: 'FOREIGN_RECORD' })
    // Sich selbst stempeln bleibt ihm unbenommen.
    expect(checkTimeClockRequest(manager, target({ _id: manager._id }))).toBeNull()
  })

  it('fremder Mandant → FOREIGN_TENANT, und zwar VOR der Datensatz-Pruefung', () => {
    // Sonst waere die Ablehnung fuer „fremder Tenant" und „fremder Kollege"
    // dieselbe — ein Oracle darueber, ob eine geratene UUID im eigenen
    // Mandanten liegt.
    expect(checkTimeClockRequest(staff, target({ tenantId: 't-2' }))).toMatchObject({ reason: 'FOREIGN_TENANT' })
    expect(checkTimeClockRequest(owner, target({ tenantId: 't-2' }))).toMatchObject({ reason: 'FOREIGN_TENANT' })
  })

  it('Actor ohne tenantId (virtueller Geraete-User vor dem Pairing) → kein Tenant-Vergleich', () => {
    expect(checkTimeClockRequest({ _id: 'device:dev-1', role: UserSystemRole.DEVICE_POS }, target())).toBeNull()
  })

  describe('Geraete-Zuweisung (PNRY-FEAT-DEVICE-ASSIGNMENT-001)', () => {
    it('nicht zugewiesener Mitarbeiter → NOT_ASSIGNED, auch fuer die Geraete-Rolle', () => {
      expect(checkTimeClockRequest(device, target(), { deviceAccessScope: ['u-someone-else'] })).toMatchObject({
        reason: 'NOT_ASSIGNED',
      })
    })

    it('zugewiesener Mitarbeiter → erlaubt', () => {
      expect(checkTimeClockRequest(device, target(), { deviceAccessScope: ['u-victim'] })).toBeNull()
    })

    it('leerer Scope sperrt alle — „niemand" ist nicht „keine Einschraenkung"', () => {
      expect(checkTimeClockRequest(device, target(), { deviceAccessScope: [] })).toMatchObject({
        reason: 'NOT_ASSIGNED',
      })
    })

    it('null/undefined = keine Einschraenkung (shared-Geraet, Nicht-Geraete-Rolle)', () => {
      expect(checkTimeClockRequest(device, target(), { deviceAccessScope: null })).toBeNull()
      expect(checkTimeClockRequest(device, target(), {})).toBeNull()
    })

    it('gilt auch fuer privilegierte Rollen — der Scope traegt die Exempt-Rollen bereits', () => {
      // resolveDeviceAccessScope mischt DEVICE_ACCESS_EXEMPT_ROLES in die Liste;
      // wer hier nicht drinsteht, gehoert auch nicht dazu.
      expect(
        checkTimeClockRequest(owner, target({ _id: 'u-owner' }), { deviceAccessScope: ['u-other'] }),
      ).toMatchObject({ reason: 'NOT_ASSIGNED' })
    })
  })

  describe('Kontostatus (#187)', () => {
    it.each([UserStatus.ARCHIVED, UserStatus.REJECTED])('%s → INACTIVE_ACCOUNT', status => {
      expect(checkTimeClockRequest(device, target({ status }))).toMatchObject({ reason: 'INACTIVE_ACCOUNT' })
    })

    it('greift auch beim Selbst-Stempeln', () => {
      expect(checkTimeClockRequest(staff, target({ _id: staff._id, status: UserStatus.ARCHIVED }))).toMatchObject({
        reason: 'INACTIVE_ACCOUNT',
      })
    })

    it('fehlender Status laesst durch (virtueller Geraete-User hat keinen)', () => {
      expect(checkTimeClockRequest(device, target({ status: undefined }))).toBeNull()
    })
  })
})

describe('assertTimeClockAccess', () => {
  it('wirft Forbidden mit der Meldung der Verletzung', () => {
    expect(() => assertTimeClockAccess(staff, target())).toThrowError(
      /Zeiterfassung ist nur fuer den eigenen Benutzer moeglich/,
    )
    try {
      assertTimeClockAccess(staff, target())
    } catch (error) {
      expect((error as { code?: number }).code).toBe(403)
    }
  })

  it('erlaubter Aufruf wirft nicht', () => {
    expect(() => assertTimeClockAccess(staff, target({ _id: staff._id }))).not.toThrow()
  })
})
