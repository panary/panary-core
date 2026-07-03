import { describe, expect, it, vi } from 'vitest'
import { BadRequest, Forbidden } from '@feathersjs/errors'

import { restrictPermissionGrants } from './restrict-permission-grants.hook'

import type { HookContext } from '../declarations'

// Die fachliche Pruefung lebt in der geteilten Policy (@panary/users/domain,
// grant-assignment-policy.spec.ts) — hier nur die Adapter-Mechanik des Hooks:
// interner Bypass, Delta-Bildung gegen den bestehenden Datensatz und das
// Mapping der Policy-Verletzung auf Forbidden/BadRequest.
const makeContext = (opts: {
  provider?: string
  user?: unknown
  method?: string
  id?: string | null
  data?: unknown
  existingPermissions?: string[]
}): HookContext => {
  const get = vi.fn().mockResolvedValue({ _id: opts.id, permissions: opts.existingPermissions ?? [] })
  return {
    params: { provider: opts.provider, user: opts.user },
    method: opts.method ?? 'patch',
    id: opts.id,
    data: opts.data,
    path: 'users',
    app: { service: () => ({ get }) },
  } as unknown as HookContext
}

const owner = { _id: 'owner-1', role: 'tenant:owner' }

describe('restrictPermissionGrants (Feathers-Adapter)', () => {
  it('interner Call (kein provider) → Bypass, auch bei eskalierenden Grants', async () => {
    const context = makeContext({ id: 'user-2', data: { permissions: ['grant:accounts:manage'] } })
    await expect(restrictPermissionGrants(context)).resolves.toBe(context)
  })

  it('externer patch mit unzulaessigem Grant → Forbidden mit Policy-Message', async () => {
    const context = makeContext({
      provider: 'rest',
      user: owner,
      id: 'user-2',
      data: { permissions: ['grant:accounts:manage'] },
    })
    await expect(restrictPermissionGrants(context)).rejects.toThrowError(Forbidden)
    await expect(restrictPermissionGrants(context)).rejects.toThrowError(
      'Sie dürfen die Berechtigung „grant:accounts:manage" nicht vergeben.',
    )
  })

  it('externer patch: bereits gesetzter Grant bleibt erlaubt (Delta-Semantik)', async () => {
    const context = makeContext({
      provider: 'rest',
      user: owner,
      id: 'user-2',
      data: { permissions: ['grant:accounts:manage'] },
      existingPermissions: ['grant:accounts:manage'],
    })
    await expect(restrictPermissionGrants(context)).resolves.toBe(context)
  })

  it('externer create mit Grant innerhalb der Decke → passiert unveraendert', async () => {
    const context = makeContext({
      provider: 'rest',
      user: owner,
      method: 'create',
      id: null,
      data: { permissions: ['grant:orders:read', 'can_discount'] },
    })
    await expect(restrictPermissionGrants(context)).resolves.toBe(context)
  })

  it('externer create mit ungueltigem Grant-Format → BadRequest', async () => {
    const context = makeContext({
      provider: 'rest',
      user: owner,
      method: 'create',
      id: null,
      data: { permissions: ['grant:doesnotexist:manage'] },
    })
    await expect(restrictPermissionGrants(context)).rejects.toThrowError(BadRequest)
  })

  it('Body ohne permissions-Feld → kein interner get, kein Fehler', async () => {
    const get = vi.fn()
    const context = {
      params: { provider: 'rest', user: owner },
      method: 'create',
      id: null,
      data: { firstName: 'Max' },
      path: 'users',
      app: { service: () => ({ get }) },
    } as unknown as HookContext
    await expect(restrictPermissionGrants(context)).resolves.toBe(context)
    expect(get).not.toHaveBeenCalled()
  })
})
