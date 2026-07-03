import { describe, expect, it } from 'vitest'

import { checkUserSelfPatch, PRIVILEGED_ROLES, SELF_PATCHABLE_FIELDS } from './self-patch-policy'
import { UserSystemRole } from './user.schema'

const staff = { _id: 'user-1', role: UserSystemRole.TENANT_STAFF }

describe('checkUserSelfPatch', () => {
  it('fehlender oder rollenloser User → MISSING_USER', () => {
    expect(checkUserSelfPatch(undefined, 'user-1', {})?.reason).toBe('MISSING_USER')
    expect(checkUserSelfPatch({ _id: 'user-1' }, 'user-1', {})?.reason).toBe('MISSING_USER')
    expect(checkUserSelfPatch(undefined, 'user-1', {})?.message).toBe('Authentifizierter User fehlt.')
  })

  it('STAFF patcht fremde userId → FOREIGN_RECORD', () => {
    const violation = checkUserSelfPatch(staff, 'user-2', { posPin: '1234' })
    expect(violation?.reason).toBe('FOREIGN_RECORD')
    expect(violation?.message).toBe('Eigene User-Daten koennen nur vom eingeloggten User selbst geaendert werden.')
  })

  it('role am eigenen Record → FORBIDDEN_FIELD', () => {
    const violation = checkUserSelfPatch(staff, 'user-1', { role: UserSystemRole.TENANT_OWNER })
    expect(violation).toEqual({
      reason: 'FORBIDDEN_FIELD',
      field: 'role',
      message: "Feld 'role' kann nicht im Self-Service geaendert werden. Erlaubt: posPin, password, email.",
    })
  })

  it('permissions am eigenen Record → FORBIDDEN_FIELD (Grant-Eskalation)', () => {
    const violation = checkUserSelfPatch(staff, 'user-1', { permissions: ['grant:users:manage'] })
    expect(violation?.reason).toBe('FORBIDDEN_FIELD')
    expect(violation?.field).toBe('permissions')
  })

  it('tenantId-/Location-Eskalation am eigenen Record → FORBIDDEN_FIELD', () => {
    expect(checkUserSelfPatch(staff, 'user-1', { tenantId: 't-2' })?.field).toBe('tenantId')
    expect(checkUserSelfPatch(staff, 'user-1', { activeLocationId: 'loc-2' })?.field).toBe('activeLocationId')
    expect(checkUserSelfPatch(staff, 'user-1', { allowedLocationIds: ['loc-2'] })?.field).toBe('allowedLocationIds')
  })

  it('posPin/password/email am eigenen Record → erlaubt', () => {
    expect(checkUserSelfPatch(staff, 'user-1', { posPin: '1234' })).toBeNull()
    expect(checkUserSelfPatch(staff, 'user-1', { password: 'geheim' })).toBeNull()
    expect(checkUserSelfPatch(staff, 'user-1', { email: 'neu@example.com' })).toBeNull()
    expect(checkUserSelfPatch(staff, 'user-1', { posPin: '1234', password: 'x', email: 'a@b.de' })).toBeNull()
  })

  it('gemischter Body (whitelisted + verboten) → FORBIDDEN_FIELD', () => {
    expect(checkUserSelfPatch(staff, 'user-1', { posPin: '1234', role: 'tenant:owner' })?.field).toBe('role')
  })

  it('leerer oder fehlender Body am eigenen Record → erlaubt', () => {
    expect(checkUserSelfPatch(staff, 'user-1', {})).toBeNull()
    expect(checkUserSelfPatch(staff, 'user-1', undefined)).toBeNull()
  })

  it('MANAGER unterliegt der Restriction (kein Bypass)', () => {
    const manager = { _id: 'user-1', role: UserSystemRole.TENANT_MANAGER }
    expect(checkUserSelfPatch(manager, 'user-2', { posPin: '1' })?.reason).toBe('FOREIGN_RECORD')
    expect(checkUserSelfPatch(manager, 'user-1', { role: 'tenant:owner' })?.reason).toBe('FORBIDDEN_FIELD')
  })

  it('PRIVILEGED_ROLES → Bypass (fremde Id + beliebige Felder)', () => {
    for (const role of PRIVILEGED_ROLES) {
      const actor = { _id: 'admin-1', role }
      expect(checkUserSelfPatch(actor, 'user-2', { role: 'tenant:owner', permissions: [] }), role).toBeNull()
    }
  })
})

describe('Invarianten (Regressionsanker)', () => {
  it('PRIVILEGED_ROLES = exakt die MANAGE-users-Rollen', () => {
    expect([...PRIVILEGED_ROLES].sort()).toEqual(
      [
        UserSystemRole.PLATFORM_OWNER,
        UserSystemRole.PLATFORM_ADMIN,
        UserSystemRole.PLATFORM_SUPPORT,
        UserSystemRole.TENANT_OWNER,
        UserSystemRole.TENANT_TECHNICIAN,
      ].sort(),
    )
  })

  it('SELF_PATCHABLE_FIELDS enthaelt keine Eskalations-Felder', () => {
    for (const field of ['permissions', 'role', 'tenantId', 'locationId', 'activeLocationId', 'allowedLocationIds']) {
      expect(SELF_PATCHABLE_FIELDS.has(field), field).toBe(false)
    }
  })

  it('Whitelist ist exakt posPin/password/email', () => {
    expect([...SELF_PATCHABLE_FIELDS].sort()).toEqual(['email', 'password', 'posPin'])
  })
})
