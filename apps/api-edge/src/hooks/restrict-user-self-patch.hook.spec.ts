import { describe, expect, it } from 'vitest'
import { Forbidden } from '@feathersjs/errors'

import { restrictUserSelfPatch } from './restrict-user-self-patch.hook'

import type { HookContext } from '../declarations'

// Die fachliche Pruefung lebt in der geteilten Policy (@panary/users/domain,
// self-patch-policy.spec.ts) — hier nur die Adapter-Mechanik des Hooks:
// interner Bypass + Mapping der Policy-Verletzung auf Forbidden.
const makeContext = (opts: { provider?: string; user?: unknown; id?: string; data?: unknown }): HookContext =>
  ({
    params: { provider: opts.provider, user: opts.user },
    id: opts.id,
    data: opts.data,
  }) as unknown as HookContext

describe('restrictUserSelfPatch (Feathers-Adapter)', () => {
  it('interner Call (kein provider) → Bypass, auch bei fremder Id + verbotenen Feldern', async () => {
    const context = makeContext({ id: 'user-2', data: { role: 'tenant:owner' } })
    await expect(restrictUserSelfPatch(context)).resolves.toBe(context)
  })

  it('externer Call: Policy-Verletzung → Forbidden mit Policy-Message', async () => {
    const context = makeContext({
      provider: 'rest',
      user: { _id: 'user-1', role: 'tenant:staff' },
      id: 'user-1',
      data: { permissions: ['grant:users:manage'] },
    })
    await expect(restrictUserSelfPatch(context)).rejects.toThrowError(Forbidden)
    await expect(restrictUserSelfPatch(context)).rejects.toThrowError(
      "Feld 'permissions' kann nicht im Self-Service geaendert werden. Erlaubt: posPin, password, email.",
    )
  })

  it('externer Call: Self-Patch mit whitelisted Feldern → passiert unveraendert', async () => {
    const context = makeContext({
      provider: 'rest',
      user: { _id: 'user-1', role: 'tenant:staff' },
      id: 'user-1',
      data: { posPin: '1234' },
    })
    await expect(restrictUserSelfPatch(context)).resolves.toBe(context)
  })
})
