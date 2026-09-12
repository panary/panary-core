import { describe, expect, it } from 'vitest'

import { AppAction, AppResource } from './permissions'
import { RolePermissions } from './roles.matrix'
import { canPatchAnyUser, canSeeAllUsers, PRIVILEGED_ROLES, USER_VISIBILITY_ALL_ROLES } from './user-access-policy'
import { UserSystemRole } from './user.schema'

/** Rollen, denen die RolePermissions-Matrix `users: <action>` gibt. */
const rolesWithUsersAction = (action: AppAction): string[] =>
  Object.entries(RolePermissions)
    .filter(([, rules]) =>
      rules.some(
        rule =>
          typeof rule === 'object' &&
          'resource' in rule &&
          rule.resource === AppResource.USERS &&
          (Array.isArray(rule.action) ? rule.action : [rule.action]).includes(action),
      ),
    )
    .map(([role]) => role)

describe('canSeeAllUsers / canPatchAnyUser', () => {
  it('fehlende Rolle → nein (kein Bypass durch undefined)', () => {
    expect(canSeeAllUsers(undefined)).toBe(false)
    expect(canPatchAnyUser(undefined)).toBe(false)
    expect(canSeeAllUsers('')).toBe(false)
  })

  it('TENANT_TECHNICIAN sieht alle UND patcht alle (Notzugang, #275)', () => {
    expect(canSeeAllUsers(UserSystemRole.TENANT_TECHNICIAN)).toBe(true)
    expect(canPatchAnyUser(UserSystemRole.TENANT_TECHNICIAN)).toBe(true)
  })

  it('TENANT_MANAGER sieht alle, patcht aber nur sich selbst', () => {
    expect(canSeeAllUsers(UserSystemRole.TENANT_MANAGER)).toBe(true)
    expect(canPatchAnyUser(UserSystemRole.TENANT_MANAGER)).toBe(false)
  })

  it('TENANT_STAFF und device:*-Rollen in keiner Liste', () => {
    for (const role of [
      UserSystemRole.TENANT_STAFF,
      UserSystemRole.DEVICE_POS,
      UserSystemRole.DEVICE_KDS,
      UserSystemRole.DEVICE_TABLET,
      UserSystemRole.DEVICE_KIOSK,
    ]) {
      expect(canSeeAllUsers(role), role).toBe(false)
      expect(canPatchAnyUser(role), role).toBe(false)
    }
  })
})

describe('Invarianten (Regressionsanker #275)', () => {
  // Der eigentliche Defekt aus #275: TENANT_TECHNICIAN durfte patchen, sah
  // aber nur sich selbst — das Query-Scoping wirkt auch bei `patch` by id,
  // ein Patch auf fremde Nutzer endete daher in 404 statt 403.
  it('wer alle patchen darf, muss alle sehen duerfen (PRIVILEGED ⊆ VISIBILITY)', () => {
    const blind = [...PRIVILEGED_ROLES].filter(role => !USER_VISIBILITY_ALL_ROLES.has(role))
    expect(blind).toEqual([])
  })

  it('jede Rolle mit users:MANAGE laut Matrix steht in BEIDEN Listen', () => {
    for (const role of rolesWithUsersAction(AppAction.MANAGE)) {
      expect(USER_VISIBILITY_ALL_ROLES.has(role), `${role} sieht nicht alle`).toBe(true)
      expect(PRIVILEGED_ROLES.has(role), `${role} patcht nicht alle`).toBe(true)
    }
  })

  it('users:MANAGE laut Matrix = platform:owner, tenant:owner, tenant:technician', () => {
    expect(rolesWithUsersAction(AppAction.MANAGE).sort()).toEqual(
      [UserSystemRole.PLATFORM_OWNER, UserSystemRole.TENANT_OWNER, UserSystemRole.TENANT_TECHNICIAN].sort(),
    )
  })

  // Umgekehrte Richtung: keine Rolle rutscht in eine Liste, die laut Matrix
  // gar kein users-Recht hat.
  it('keine Liste enthaelt eine Rolle ohne users-Recht in der Matrix', () => {
    const withAnyUsersRule = new Set(
      Object.entries(RolePermissions)
        .filter(([, rules]) =>
          rules.some(rule => typeof rule === 'object' && 'resource' in rule && rule.resource === AppResource.USERS),
        )
        .map(([role]) => role),
    )
    for (const role of [...PRIVILEGED_ROLES, ...USER_VISIBILITY_ALL_ROLES]) {
      expect(withAnyUsersRule.has(role), role).toBe(true)
    }
  })

  it('Mitgliedschaft exakt wie in der Entscheidungstabelle dokumentiert', () => {
    expect([...PRIVILEGED_ROLES].sort()).toEqual(
      [
        UserSystemRole.PLATFORM_OWNER,
        UserSystemRole.PLATFORM_ADMIN,
        UserSystemRole.PLATFORM_SUPPORT,
        UserSystemRole.TENANT_OWNER,
        UserSystemRole.TENANT_TECHNICIAN,
      ].sort(),
    )
    expect([...USER_VISIBILITY_ALL_ROLES].sort()).toEqual(
      [
        UserSystemRole.PLATFORM_OWNER,
        UserSystemRole.PLATFORM_ADMIN,
        UserSystemRole.PLATFORM_SUPPORT,
        UserSystemRole.TENANT_OWNER,
        UserSystemRole.TENANT_MANAGER,
        UserSystemRole.TENANT_TECHNICIAN,
      ].sort(),
    )
  })
})
