import { describe, expect, it } from 'vitest'

import { AppAction, AppResource } from './permissions'
import { UserSystemRole } from './user.schema'
import {
  GRANT_PREFIX,
  hasEffectivePermission,
  isValidGrant,
  makeGrant,
  parseGrant,
} from './effective-permissions'
import { CapabilityBundles, expandBundles } from './capability-bundles'

const IG = AppResource.INCOMING_GOODS

describe('parseGrant / isValidGrant / makeGrant', () => {
  it('makeGrant baut das prefixed Format', () => {
    expect(makeGrant(IG, AppAction.MANAGE)).toBe(`${GRANT_PREFIX}incoming-goods:manage`)
  })

  it('parst eine gültige Grant-Zeichenkette', () => {
    expect(parseGrant('grant:incoming-goods:manage')).toEqual({ resource: 'incoming-goods', action: 'manage' })
  })

  it('parst Ressourcen mit Slash (Split am letzten Doppelpunkt)', () => {
    expect(parseGrant('grant:external/off-lookup:read')).toEqual({
      resource: 'external/off-lookup',
      action: 'read',
    })
  })

  it('lehnt unbekannte Ressource / Aktion / Format ab', () => {
    expect(parseGrant('grant:bogus-resource:read')).toBeNull()
    expect(parseGrant('grant:incoming-goods:fly')).toBeNull()
    expect(parseGrant('grant:incoming-goods')).toBeNull()
    expect(parseGrant('can_discount')).toBeNull()
    expect(parseGrant('')).toBeNull()
  })

  it('isValidGrant spiegelt parseGrant', () => {
    expect(isValidGrant('grant:incoming-goods:manage')).toBe(true)
    expect(isValidGrant('grant:incoming-goods:fly')).toBe(false)
    expect(isValidGrant('can_discount')).toBe(false)
  })
})

describe('hasEffectivePermission', () => {
  it('Rolle allein: STAFF hat KEIN incoming-goods (Ursprung des 403)', () => {
    expect(hasEffectivePermission(UserSystemRole.TENANT_STAFF, [], IG, AppAction.READ)).toBe(false)
  })

  it('Rolle allein: MANAGER hat incoming-goods (MANAGE)', () => {
    expect(hasEffectivePermission(UserSystemRole.TENANT_MANAGER, [], IG, AppAction.READ)).toBe(true)
    expect(hasEffectivePermission(UserSystemRole.TENANT_MANAGER, [], IG, AppAction.UPDATE)).toBe(true)
  })

  it('additiver Grant entsperrt: STAFF + grant:incoming-goods:manage', () => {
    const perms = ['grant:incoming-goods:manage']
    expect(hasEffectivePermission(UserSystemRole.TENANT_STAFF, perms, IG, AppAction.READ)).toBe(true)
    expect(hasEffectivePermission(UserSystemRole.TENANT_STAFF, perms, IG, AppAction.UPDATE)).toBe(true)
  })

  it('grant:read deckt nicht update ab', () => {
    const perms = ['grant:incoming-goods:read']
    expect(hasEffectivePermission(UserSystemRole.TENANT_STAFF, perms, IG, AppAction.READ)).toBe(true)
    expect(hasEffectivePermission(UserSystemRole.TENANT_STAFF, perms, IG, AppAction.UPDATE)).toBe(false)
  })

  it('Grant gilt nur für die genannte Ressource', () => {
    const perms = ['grant:incoming-goods:manage']
    expect(
      hasEffectivePermission(UserSystemRole.TENANT_STAFF, perms, AppResource.INVENTORIES, AppAction.READ),
    ).toBe(false)
  })

  it('Grant ohne Rolle wirkt eigenständig', () => {
    expect(hasEffectivePermission(undefined, ['grant:incoming-goods:manage'], IG, AppAction.READ)).toBe(true)
  })

  it('unbekannte/abilities-Tokens gewähren nichts', () => {
    const perms = ['can_discount', 'grant:bogus:read', 'grant:incoming-goods:fly']
    expect(hasEffectivePermission(UserSystemRole.TENANT_STAFF, perms, IG, AppAction.READ)).toBe(false)
  })
})

describe('CapabilityBundles / expandBundles', () => {
  it('jeder Bundle-Grant ist ein gültiger Grant', () => {
    for (const bundle of CapabilityBundles) {
      for (const grant of bundle.grants) {
        expect(isValidGrant(grant), `${bundle.id}: ${grant}`).toBe(true)
      }
    }
  })

  it('Wareneingang-Bundle entsperrt incoming-goods', () => {
    const grants = expandBundles(['wareneingang'])
    expect(grants).toContain('grant:incoming-goods:manage')
    expect(hasEffectivePermission(UserSystemRole.TENANT_STAFF, grants, IG, AppAction.READ)).toBe(true)
  })

  it('expandBundles dedupliziert über Bundles hinweg + ignoriert Unbekanntes', () => {
    const grants = expandBundles(['wareneingang', 'inventur-bestand', 'gibt-es-nicht'])
    const stock = grants.filter(x => x === 'grant:stock-levels:read')
    expect(stock).toHaveLength(1)
  })
})
