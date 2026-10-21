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
      "Feld 'permissions' kann nicht im Self-Service geaendert werden. Erlaubt: posPin, password, email, posHandedness.",
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

  // multiTenancy() stempelt `tenantId` vor diesem Hook in den Body (panary/panary-core#827).
  it('externer Call: vom multiTenancy gestempelter eigener tenantId → kein Verstoss', async () => {
    const context = makeContext({
      provider: 'rest',
      user: { _id: 'user-1', role: 'tenant:staff', tenantId: 't-1' },
      id: 'user-1',
      data: { posHandedness: 'right', tenantId: 't-1' },
    })
    await expect(restrictUserSelfPatch(context)).resolves.toBe(context)
  })

  it('externer Call: fremder tenantId im Body → Forbidden', async () => {
    const context = makeContext({
      provider: 'rest',
      user: { _id: 'user-1', role: 'tenant:staff', tenantId: 't-1' },
      id: 'user-1',
      data: { posHandedness: 'right', tenantId: 't-2' },
    })
    await expect(restrictUserSelfPatch(context)).rejects.toThrowError("Feld 'tenantId'")
  })

  it('externer Call: Actor ohne tenantId → gestempeltes Feld bleibt und wird abgewiesen', async () => {
    const context = makeContext({
      provider: 'rest',
      user: { _id: 'user-1', role: 'tenant:staff' },
      id: 'user-1',
      data: { tenantId: 't-1' },
    })
    await expect(restrictUserSelfPatch(context)).rejects.toThrowError(Forbidden)
  })
})
