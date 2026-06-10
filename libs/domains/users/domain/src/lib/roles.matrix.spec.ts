import { AppAction, AppResource } from './permissions'
import { RolePermissions, type PermissionRule } from './roles.matrix'
import { UserSystemRole } from './user.schema'

/**
 * Helfer: Prüft, ob für eine Rolle/Resource eine bestimmte Aktion erlaubt ist.
 * Akzeptiert sowohl MANAGE (deckt alles ab) als auch einzelne Aktionen.
 */
function roleCan(role: UserSystemRole, resource: AppResource, action: AppAction): boolean {
  const rules = RolePermissions[role]
  for (const rule of rules) {
    if (typeof rule === 'string') continue
    if (rule.resource !== resource) continue
    const actions = Array.isArray(rule.action) ? rule.action : [rule.action]
    if (actions.includes(AppAction.MANAGE)) return true
    if (actions.includes(action)) return true
  }
  return false
}

/**
 * Helfer: Liefert die Liste aller erlaubten Aktionen einer Rolle auf einer Resource
 * (MANAGE wird zu allen 4 CRUD-Aktionen expandiert).
 */
function roleActions(role: UserSystemRole, resource: AppResource): AppAction[] {
  const result = new Set<AppAction>()
  for (const rule of RolePermissions[role]) {
    if (typeof rule === 'string') continue
    if (rule.resource !== resource) continue
    const actions = Array.isArray(rule.action) ? rule.action : [rule.action]
    for (const a of actions) {
      if (a === AppAction.MANAGE) {
        result.add(AppAction.CREATE)
        result.add(AppAction.READ)
        result.add(AppAction.UPDATE)
        result.add(AppAction.DELETE)
      } else {
        result.add(a)
      }
    }
  }
  return [...result]
}

describe('RolePermissions — Phase 6 (BRAND + RESERVATION)', () => {
  const newResources: AppResource[] = [
    AppResource.BRANDS,
    AppResource.RESERVATIONS,
    AppResource.RESERVATION_TABLES,
    AppResource.RESERVABLE_SLOTS,
  ]

  describe('TENANT_OWNER — voller CRUD auf allen 4 neuen Resources', () => {
    for (const resource of newResources) {
      it(`hat CREATE+READ+UPDATE+DELETE auf ${resource}`, () => {
        const actions = roleActions(UserSystemRole.TENANT_OWNER, resource)
        expect(actions).toEqual(expect.arrayContaining([
          AppAction.CREATE,
          AppAction.READ,
          AppAction.UPDATE,
          AppAction.DELETE,
        ]))
      })
    }
  })

  describe('TENANT_MANAGER — voller CRUD auf allen 4 neuen Resources', () => {
    for (const resource of newResources) {
      it(`hat CREATE+READ+UPDATE+DELETE auf ${resource}`, () => {
        const actions = roleActions(UserSystemRole.TENANT_MANAGER, resource)
        expect(actions).toEqual(expect.arrayContaining([
          AppAction.CREATE,
          AppAction.READ,
          AppAction.UPDATE,
          AppAction.DELETE,
        ]))
      })
    }
  })

  describe('TENANT_STAFF — reduzierter Scope (Reservation operativ, Brand/Tables/Slots nur READ)', () => {
    it('hat NUR READ auf BRANDS', () => {
      const actions = roleActions(UserSystemRole.TENANT_STAFF, AppResource.BRANDS)
      expect(actions).toEqual([AppAction.READ])
    })

    it('hat READ + UPDATE auf RESERVATIONS (Status-Setzen)', () => {
      const actions = roleActions(UserSystemRole.TENANT_STAFF, AppResource.RESERVATIONS)
      expect(actions).toEqual(expect.arrayContaining([AppAction.READ, AppAction.UPDATE]))
    })

    it('hat KEIN CREATE auf RESERVATIONS', () => {
      expect(roleCan(UserSystemRole.TENANT_STAFF, AppResource.RESERVATIONS, AppAction.CREATE)).toBe(false)
    })

    it('hat KEIN DELETE auf RESERVATIONS', () => {
      expect(roleCan(UserSystemRole.TENANT_STAFF, AppResource.RESERVATIONS, AppAction.DELETE)).toBe(false)
    })

    it('hat NUR READ auf RESERVATION_TABLES', () => {
      const actions = roleActions(UserSystemRole.TENANT_STAFF, AppResource.RESERVATION_TABLES)
      expect(actions).toEqual([AppAction.READ])
    })

    it('hat NUR READ auf RESERVABLE_SLOTS', () => {
      const actions = roleActions(UserSystemRole.TENANT_STAFF, AppResource.RESERVABLE_SLOTS)
      expect(actions).toEqual([AppAction.READ])
    })
  })

  describe('PLATFORM_ADMIN — voller CRUD auf allen 4 neuen Resources', () => {
    for (const resource of newResources) {
      it(`hat CREATE+READ+UPDATE+DELETE auf ${resource}`, () => {
        const actions = roleActions(UserSystemRole.PLATFORM_ADMIN, resource)
        expect(actions).toEqual(expect.arrayContaining([
          AppAction.CREATE,
          AppAction.READ,
          AppAction.UPDATE,
          AppAction.DELETE,
        ]))
      })
    }
  })

  describe('PLATFORM_SUPPORT — READ auf BRANDS für Diagnose-Sicht', () => {
    it('hat READ auf BRANDS', () => {
      expect(roleCan(UserSystemRole.PLATFORM_SUPPORT, AppResource.BRANDS, AppAction.READ)).toBe(true)
    })

    it('hat KEIN CREATE auf BRANDS', () => {
      expect(roleCan(UserSystemRole.PLATFORM_SUPPORT, AppResource.BRANDS, AppAction.CREATE)).toBe(false)
    })
  })

  describe('Regression: bestehende Matrix-Einträge unverändert', () => {
    it('TENANT_OWNER hat MANAGE auf USERS', () => {
      const rules = RolePermissions[UserSystemRole.TENANT_OWNER] as PermissionRule[]
      expect(rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ resource: AppResource.USERS, action: AppAction.MANAGE }),
        ]),
      )
    })

    it('TENANT_STAFF hat READ + CREATE auf ORDERS', () => {
      expect(roleCan(UserSystemRole.TENANT_STAFF, AppResource.ORDERS, AppAction.READ)).toBe(true)
      expect(roleCan(UserSystemRole.TENANT_STAFF, AppResource.ORDERS, AppAction.CREATE)).toBe(true)
    })

    it('TENANT_OWNER hat CREATE + READ auf STOREFRONT_PUBLISH', () => {
      expect(roleCan(UserSystemRole.TENANT_OWNER, AppResource.STOREFRONT_PUBLISH, AppAction.CREATE)).toBe(true)
      expect(roleCan(UserSystemRole.TENANT_OWNER, AppResource.STOREFRONT_PUBLISH, AppAction.READ)).toBe(true)
    })

    it('TENANT_OWNER + TENANT_MANAGER haben CREATE auf STOREFRONT_PUBLISH_BRAND + ROLLBACK, STAFF nicht', () => {
      for (const role of [UserSystemRole.TENANT_OWNER, UserSystemRole.TENANT_MANAGER]) {
        expect(roleCan(role, AppResource.STOREFRONT_PUBLISH_BRAND, AppAction.CREATE)).toBe(true)
        expect(roleCan(role, AppResource.STOREFRONT_PUBLISH_ROLLBACK, AppAction.CREATE)).toBe(true)
      }
      expect(roleCan(UserSystemRole.TENANT_STAFF, AppResource.STOREFRONT_PUBLISH_BRAND, AppAction.CREATE)).toBe(false)
      expect(roleCan(UserSystemRole.TENANT_STAFF, AppResource.STOREFRONT_PUBLISH_ROLLBACK, AppAction.CREATE)).toBe(false)
    })
  })
})
