import { describe, expect, it } from 'vitest'

import { DEVICE_ACCESS_EXEMPT_ROLES } from '@panary/devices/domain'
import {
  CASH_SESSION_AUTHORIZING_ROLES,
  ORDER_CANCEL_AUTHORIZING_ROLES,
  POS_AUTHORIZING_ROLES,
  RolePermissions,
  UNPAIR_ALLOWED_ROLES,
  UserSystemRole,
} from '@panary/users/domain'

// Der wertvollste Test der Geraete-Zuweisung
// (PNRY-FEAT-DEVICE-ASSIGNMENT-001). Er kann nur hier stehen: die
// devices-Domain darf die users-Domain nicht importieren (Publish-Build-Zyklus,
// CLAUDE.md §2.1), weshalb DEVICE_ACCESS_EXEMPT_ROLES String-Literale haelt.
// api-edge sieht beide Libs und ist damit der einzige Ort, an dem die
// Uebereinstimmung ueberhaupt pruefbar ist — dasselbe Muster wie der
// Matrix-Sync-Anker in restrict-device-self-patch.hook.spec.ts.
//
// Faellt diese Invariante, sperrt sich ein zugewiesenes Geraet selbst aus:
// `users.find` liefert die Freigabe-Person nicht mehr, der Manager kann weder
// stornieren noch den Kassenabschluss freigeben — und das Entkoppeln waere
// unwiderruflich blockiert.
describe('DEVICE_ACCESS_EXEMPT_ROLES ⊇ POS_AUTHORIZING_ROLES', () => {
  it('jede Freigabe-Rolle bleibt auf einem zugewiesenen Geraet sichtbar', () => {
    for (const role of POS_AUTHORIZING_ROLES) {
      expect(DEVICE_ACCESS_EXEMPT_ROLES.has(role), role).toBe(true)
    }
  })

  it.each([
    ['Entkoppeln', UNPAIR_ALLOWED_ROLES],
    ['Storno-Freigabe', ORDER_CANCEL_AUTHORIZING_ROLES],
    ['Kassenabschluss-Freigabe', CASH_SESSION_AUTHORIZING_ROLES],
  ])('Notfallpfad „%s" bleibt bedienbar', (_name, roles) => {
    for (const role of roles) {
      expect(DEVICE_ACCESS_EXEMPT_ROLES.has(role), role).toBe(true)
    }
  })

  it('POS_AUTHORIZING_ROLES ist die Vereinigung der drei Kreise', () => {
    const union = new Set<string>([
      ...UNPAIR_ALLOWED_ROLES,
      ...ORDER_CANCEL_AUTHORIZING_ROLES,
      ...CASH_SESSION_AUTHORIZING_ROLES,
    ])
    expect([...POS_AUTHORIZING_ROLES].sort()).toEqual([...union].sort())
  })

  it('alle Freigabe-Rollen existieren in der RolePermissions-Matrix', () => {
    // Ein Tippfehler in einer der String-Listen wuerde sonst still als
    // „niemand hat diese Rolle" durchgehen.
    const knownRoles = new Set<string>(Object.keys(RolePermissions))
    for (const role of POS_AUTHORIZING_ROLES) {
      expect(knownRoles.has(role), role).toBe(true)
    }
    for (const role of DEVICE_ACCESS_EXEMPT_ROLES) {
      expect(knownRoles.has(role), role).toBe(true)
    }
  })

  it('keine Geraete-Rolle ist exempt', () => {
    const deviceRoles = [
      UserSystemRole.DEVICE_POS,
      UserSystemRole.DEVICE_KDS,
      UserSystemRole.DEVICE_TABLET,
      UserSystemRole.DEVICE_KIOSK,
    ]
    for (const role of deviceRoles) {
      expect(DEVICE_ACCESS_EXEMPT_ROLES.has(role), role).toBe(false)
    }
  })
})
