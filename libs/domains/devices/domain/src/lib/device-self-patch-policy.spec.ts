import { describe, expect, it } from 'vitest'

import { DEVICE_ASSIGNMENT_FIELDS } from './device-access-mode'
import { checkDeviceSelfPatch, DEVICE_PRIVILEGED_ROLES, SELF_PATCHABLE_DEVICE_FIELDS } from './device-self-patch-policy'

const posDevice = {
  role: 'device:pos-client',
  deviceId: 'dev-1',
  tenantId: 't-1',
  locationId: 'loc-1',
}

describe('checkDeviceSelfPatch', () => {
  it('fehlender oder rollenloser Actor → MISSING_ACTOR', () => {
    expect(checkDeviceSelfPatch(undefined, 'dev-1', {})?.reason).toBe('MISSING_ACTOR')
    expect(checkDeviceSelfPatch({ deviceId: 'dev-1' }, 'dev-1', {})?.reason).toBe('MISSING_ACTOR')
    expect(checkDeviceSelfPatch(undefined, 'dev-1', {})?.message).toBe('Authentifizierter Actor fehlt.')
  })

  it('POS-Device patcht fremdes Geraet → FOREIGN_RECORD', () => {
    const violation = checkDeviceSelfPatch(posDevice, 'dev-2', { uiScale: { density: 'large' } })
    expect(violation?.reason).toBe('FOREIGN_RECORD')
    expect(violation?.message).toBe('Geraete-Einstellungen koennen nur vom Geraet selbst geaendert werden.')
  })

  it('Actor ohne deviceId (User-Auth, non-privilegiert) → FOREIGN_RECORD', () => {
    const staff = { role: 'tenant:staff', tenantId: 't-1' }
    expect(checkDeviceSelfPatch(staff, 'dev-1', { uiScale: { density: 'compact' } })?.reason).toBe('FOREIGN_RECORD')
  })

  it('apiKeyId/active/type/name am eigenen Record → FORBIDDEN_FIELD', () => {
    expect(checkDeviceSelfPatch(posDevice, 'dev-1', { apiKeyId: 'key-2' })?.field).toBe('apiKeyId')
    expect(checkDeviceSelfPatch(posDevice, 'dev-1', { active: false })?.field).toBe('active')
    expect(checkDeviceSelfPatch(posDevice, 'dev-1', { type: 'kds' })?.field).toBe('type')
    const violation = checkDeviceSelfPatch(posDevice, 'dev-1', { name: 'Hacked' })
    expect(violation).toEqual({
      reason: 'FORBIDDEN_FIELD',
      field: 'name',
      message: "Feld 'name' kann nicht im Geraete-Self-Service geaendert werden. Erlaubt: uiScale.",
    })
  })

  it('uiScale am eigenen Record → erlaubt', () => {
    expect(checkDeviceSelfPatch(posDevice, 'dev-1', { uiScale: { density: 'comfortable' } })).toBeNull()
    expect(
      checkDeviceSelfPatch(posDevice, 'dev-1', { uiScale: { density: 'large', factors: { large: 1.4 } } }),
    ).toBeNull()
  })

  it('multiTenancy-Stamp-Echo (eigene tenantId/locationId) → toleriert', () => {
    // Der multiTenancy-Hook stempelt tenantId/locationId in den Body BEVOR
    // der Restrict-Hook laeuft — mit den eigenen Werten muss das passieren.
    expect(
      checkDeviceSelfPatch(posDevice, 'dev-1', {
        uiScale: { density: 'default' },
        tenantId: 't-1',
        locationId: 'loc-1',
      }),
    ).toBeNull()
  })

  it('fremde tenantId/locationId im Body → FORBIDDEN_FIELD (Injektionsversuch)', () => {
    expect(checkDeviceSelfPatch(posDevice, 'dev-1', { tenantId: 't-2' })?.field).toBe('tenantId')
    expect(checkDeviceSelfPatch(posDevice, 'dev-1', { locationId: 'loc-2' })?.field).toBe('locationId')
  })

  it('gemischter Body (whitelisted + verboten) → FORBIDDEN_FIELD', () => {
    expect(checkDeviceSelfPatch(posDevice, 'dev-1', { uiScale: { density: 'compact' }, active: false })?.field).toBe(
      'active',
    )
  })

  it('leerer oder fehlender Body am eigenen Record → erlaubt', () => {
    expect(checkDeviceSelfPatch(posDevice, 'dev-1', {})).toBeNull()
    expect(checkDeviceSelfPatch(posDevice, 'dev-1', undefined)).toBeNull()
  })

  it('DEVICE_PRIVILEGED_ROLES → Bypass (fremde deviceId + beliebige Felder)', () => {
    for (const role of DEVICE_PRIVILEGED_ROLES) {
      const actor = { role, tenantId: 't-1' }
      expect(checkDeviceSelfPatch(actor, 'dev-2', { name: 'Neu', active: false }), role).toBeNull()
    }
  })
})

describe('Invarianten (Regressionsanker)', () => {
  it('DEVICE_PRIVILEGED_ROLES = MANAGE-devices-Rollen + PLATFORM_OWNER (Gott-Modus)', () => {
    // Matrix-Sync wird zusaetzlich in apps/api-edge (restrict-device-self-
    // patch.hook.spec.ts) gegen RolePermissions gelockt — hier der literale Anker.
    expect([...DEVICE_PRIVILEGED_ROLES].sort()).toEqual(['platform:owner', 'tenant:owner', 'tenant:technician'])
  })

  it('SELF_PATCHABLE_DEVICE_FIELDS enthaelt keine Eskalations-Felder', () => {
    for (const field of ['apiKeyId', 'tenantId', 'locationId', 'active', 'type', 'deviceId']) {
      expect(SELF_PATCHABLE_DEVICE_FIELDS.has(field), field).toBe(false)
    }
  })

  it('Zuweisungs-Felder sind NIEMALS self-patchable — sie SIND die Zugriffsentscheidung', () => {
    // Ein zugewiesenes Geraet duerfte sich sonst per Self-Patch selbst auf
    // `shared` zuruecksetzen und damit die ganze Belegschaft freischalten.
    for (const field of DEVICE_ASSIGNMENT_FIELDS) {
      expect(SELF_PATCHABLE_DEVICE_FIELDS.has(field), field).toBe(false)
      expect(checkDeviceSelfPatch(posDevice, 'dev-1', { [field]: 'shared' })?.field, field).toBe(field)
    }
  })

  it('Whitelist ist exakt uiScale', () => {
    expect([...SELF_PATCHABLE_DEVICE_FIELDS].sort()).toEqual(['uiScale'])
  })
})
