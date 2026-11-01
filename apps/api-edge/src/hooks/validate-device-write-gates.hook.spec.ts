import { describe, expect, it, vi } from 'vitest'

import { validateDeviceAssignment } from './validate-device-assignment.hook'
import { validateDeviceOrderChannel } from './validate-device-order-channel.hook'

import type { HookContext } from '../declarations'

// Array-Body an den Hook-Aufrufstellen (panary/panary-core#1254): `'field' in []` ist false, das Rollen-Gate
// wurde übersprungen. Die Hooks müssen den Array-Body genauso behandeln wie die Domain-Gates.
const makeContext = (data: unknown, opts: { role?: string; provider?: string } = {}) => {
  const get = vi.fn().mockResolvedValue({ deviceAccessMode: 'shared', assignedUserIds: [] })
  const context = {
    method: 'patch',
    id: 'dev-1',
    data,
    params: { provider: opts.provider ?? 'rest', user: opts.role ? { role: opts.role, tenantId: 't-1' } : undefined },
    app: { service: () => ({ get }) },
  } as unknown as HookContext
  return context
}

describe.each([
  ['validateDeviceOrderChannel', validateDeviceOrderChannel],
  ['validateDeviceAssignment', validateDeviceAssignment],
])('%s mit Array-Body', (_name, hook) => {
  it.each([['device:pos-client'], [undefined]])('externer Aufruf mit Rolle %s → Forbidden', async role => {
    await expect(hook(makeContext([], { role }))).rejects.toMatchObject({ code: 403 })
    await expect(
      hook(makeContext([{ defaultOrderChannel: 'pos', deviceAccessMode: 'shared' }], { role })),
    ).rejects.toMatchObject({
      code: 403,
    })
  })

  // Der Techniker darf die Zuweisung ändern (DEVICE_ACCESS_EXEMPT_ROLES), nicht aber die Standard-Bestellart.
  it('Techniker: nur das Bestellart-Gate lehnt den Array-Body ab', async () => {
    await expect(validateDeviceOrderChannel(makeContext([], { role: 'tenant:technician' }))).rejects.toMatchObject({
      code: 403,
    })
    const context = makeContext([], { role: 'tenant:technician' })
    await expect(validateDeviceAssignment(context)).resolves.toBe(context)
  })

  it('Owner passiert das Rollen-Gate, ohne dass ein Feld gesetzt wird', async () => {
    const context = makeContext([], { role: 'tenant:owner' })
    await expect(hook(context)).resolves.toBe(context)
    expect(context.data).toEqual([])
  })

  it('interner Aufruf (ohne provider) ist ausgenommen', async () => {
    const context = makeContext([], { provider: undefined })
    context.params.provider = undefined
    await expect(hook(context)).resolves.toBe(context)
  })
})
