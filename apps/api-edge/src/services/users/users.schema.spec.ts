import { describe, expect, it } from 'vitest'

import { UserStatus, UserSystemRole } from '@panary/users/domain'

import { userQueryResolver } from './users.schema'

import type { HookContext } from '../../declarations'

// Query-Scoping des users-Service (#275). Der Resolver sitzt auf der QUERY und
// wirkt damit fuer `find`, `get` UND `patch` by id — wer hier auf die eigene
// `_id` gezwungen wird, bekommt beim Patch auf fremde Nutzer ein 404 statt
// eines 403. Genau daran scheiterte `tenant:technician` als Notzugang, obwohl
// die Patch-Policy ihn durchlaesst. Die Rollen-Wahrheit liegt jetzt in
// @panary/users/domain (user-access-policy.ts) — hier wird die Wirkung geprueft.
const makeContext = (user?: unknown): HookContext =>
  ({
    path: 'users',
    method: 'find',
    params: { provider: 'rest', user },
  }) as unknown as HookContext

const resolveId = async (role: string | undefined, actorId = 'u-actor', query: { _id?: unknown } = {}) => {
  const resolved = await userQueryResolver.resolve(query, makeContext(role ? { _id: actorId, role } : undefined))
  return resolved._id
}

describe('userQueryResolver — Sichtbarkeits-Scoping', () => {
  it('interner Aufruf ohne User → Query unveraendert', async () => {
    expect(await resolveId(undefined)).toBeUndefined()
  })

  it('tenant:technician sieht die volle Liste (Regression #275)', async () => {
    expect(await resolveId(UserSystemRole.TENANT_TECHNICIAN)).toBeUndefined()
  })

  it('tenant:technician: Query auf fremde _id bleibt stehen → patch/get by id moeglich', async () => {
    expect(await resolveId(UserSystemRole.TENANT_TECHNICIAN, 'u-actor', { _id: 'u-fremd' })).toBe('u-fremd')
  })

  it('tenant:owner und tenant:manager sehen die volle Liste', async () => {
    expect(await resolveId(UserSystemRole.TENANT_OWNER)).toBeUndefined()
    expect(await resolveId(UserSystemRole.TENANT_MANAGER)).toBeUndefined()
  })

  it('platform:*-Rollen sehen die volle Liste', async () => {
    expect(await resolveId(UserSystemRole.PLATFORM_OWNER)).toBeUndefined()
    expect(await resolveId(UserSystemRole.PLATFORM_ADMIN)).toBeUndefined()
    expect(await resolveId(UserSystemRole.PLATFORM_SUPPORT)).toBeUndefined()
  })

  it('tenant:staff wird auf die eigene _id gezwungen — auch mit fremder _id in der Query', async () => {
    expect(await resolveId(UserSystemRole.TENANT_STAFF, 'u-staff')).toBe('u-staff')
    expect(await resolveId(UserSystemRole.TENANT_STAFF, 'u-staff', { _id: 'u-fremd' })).toBe('u-staff')
  })
})

describe('userQueryResolver — Status-Zwang am Geraete-Pfad (#187)', () => {
  const resolveStatus = async (role: string | undefined, query: { status?: unknown } = {}) => {
    const resolved = await userQueryResolver.resolve(query, makeContext(role ? { _id: 'u-1', role } : undefined))
    return resolved.status
  }

  it('device:*-Rolle bekommt ACTIVE erzwungen — auch bei ARCHIVED in der Query', async () => {
    expect(await resolveStatus(UserSystemRole.DEVICE_POS)).toBe(UserStatus.ACTIVE)
    expect(await resolveStatus(UserSystemRole.DEVICE_POS, { status: UserStatus.ARCHIVED })).toBe(UserStatus.ACTIVE)
  })

  it('Admin-Rollen behalten den Status-Filter — archivierte Konten bleiben reaktivierbar', async () => {
    expect(await resolveStatus(UserSystemRole.TENANT_TECHNICIAN, { status: UserStatus.ARCHIVED })).toBe(
      UserStatus.ARCHIVED,
    )
    expect(await resolveStatus(UserSystemRole.TENANT_OWNER)).toBeUndefined()
  })
})
