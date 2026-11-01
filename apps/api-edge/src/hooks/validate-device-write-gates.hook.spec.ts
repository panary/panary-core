import { describe, expect, it, vi } from 'vitest'

import { validateDeviceAssignment } from './validate-device-assignment.hook'
import { validateDeviceOrderChannel } from './validate-device-order-channel.hook'

import type { HookContext } from '../declarations'

// Array-Body an den Hook-Aufrufstellen (panary/panary-core#1254): `'field' in []` ist false, das Rollen-Gate
// wurde übersprungen. Die Hooks müssen den Array-Body genauso behandeln wie die Domain-Gates.
const makeContext = (data: unknown, opts: { role?: string; internal?: boolean } = {}) => {
  const get = vi.fn().mockResolvedValue({ deviceAccessMode: 'shared', assignedUserIds: [] })
  const context = {
    method: 'patch',
    id: 'dev-1',
    data,
    params: {
      provider: opts.internal ? undefined : 'rest',
      user: opts.role ? { role: opts.role, tenantId: 't-1' } : undefined,
    },
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

  it('Owner und interner Aufruf passieren das Rollen-Gate (Bestellart-Hook); Zuweisung weist den Array-Body ab (#1256)', async () => {
    for (const ctx of [makeContext([], { role: 'tenant:owner' }), makeContext([], { internal: true })]) {
      if (hook === validateDeviceAssignment) {
        await expect(hook(ctx)).rejects.toMatchObject({ code: 400 })
      } else {
        await expect(hook(ctx)).resolves.toBe(ctx)
        expect(ctx.data).toEqual([])
      }
    }
  })
})

// Der Techniker darf die Zuweisung ändern (DEVICE_ACCESS_EXEMPT_ROLES), nicht aber die Standard-Bestellart.
it('Techniker: Bestellart-Gate: 403, Zuweisung: 400', async () => {
  await expect(validateDeviceOrderChannel(makeContext([], { role: 'tenant:technician' }))).rejects.toMatchObject({
    code: 403,
  })
  await expect(validateDeviceAssignment(makeContext([], { role: 'tenant:technician' }))).rejects.toMatchObject({
    code: 400,
  })
})
