import { describe, expect, it } from 'vitest'
import { Forbidden } from '@feathersjs/errors'

import { DEVICE_PRIVILEGED_ROLES } from '@panary/devices/domain'
import { AppAction, AppResource, RolePermissions, UserSystemRole } from '@panary/users/domain'

import { restrictDeviceSelfPatch } from './restrict-device-self-patch.hook'

import type { HookContext } from '../declarations'

// Die fachliche Pruefung lebt in der geteilten Policy (@panary/devices/domain,
// device-self-patch-policy.spec.ts) — hier die Adapter-Mechanik des Hooks
// (interner Bypass, Ownership-Lookup via service.get, Forbidden-Mapping)
// plus der Matrix-Sync-Anker fuer DEVICE_PRIVILEGED_ROLES.
const makeContext = (opts: {
  provider?: string
  user?: unknown
  authentication?: unknown
  id?: string | null
  data?: unknown
  targetDevice?: { deviceId?: string }
}): HookContext =>
  ({
    params: { provider: opts.provider, user: opts.user, authentication: opts.authentication },
    id: opts.id,
    data: opts.data,
    app: {
      service: () => ({
        get: async () => opts.targetDevice ?? { deviceId: 'dev-1' }
      })
    }
  }) as unknown as HookContext

// Virtueller Device-User, wie ihn der allowApiKey-Hook aufbaut.
const posDeviceUser = {
  _id: 'device:dev-1',
  role: 'device:pos-client',
  tenantId: 't-1',
  locationId: 'loc-1'
}

describe('restrictDeviceSelfPatch (Feathers-Adapter)', () => {
  it('interner Call (kein provider) → Bypass, auch bei fremder Id + verbotenen Feldern', async () => {
    const context = makeContext({ id: 'rec-2', data: { active: false } })
    await expect(restrictDeviceSelfPatch(context)).resolves.toBe(context)
  })

  it('externer Call: eigenes Geraet + uiScale → passiert unveraendert', async () => {
    const context = makeContext({
      provider: 'socketio',
      user: posDeviceUser,
      id: 'rec-1',
      data: { uiScale: { density: 'large' } },
      targetDevice: { deviceId: 'dev-1' }
    })
    await expect(restrictDeviceSelfPatch(context)).resolves.toBe(context)
  })

  it('externer Call: multiTenancy-Stamp-Echo (eigene tenantId/locationId) → passiert', async () => {
    const context = makeContext({
      provider: 'socketio',
      user: posDeviceUser,
      id: 'rec-1',
      data: { uiScale: { density: 'compact' }, tenantId: 't-1', locationId: 'loc-1' },
      targetDevice: { deviceId: 'dev-1' }
    })
    await expect(restrictDeviceSelfPatch(context)).resolves.toBe(context)
  })

  it('externer Call: fremdes Geraet → Forbidden', async () => {
    const context = makeContext({
      provider: 'socketio',
      user: posDeviceUser,
      id: 'rec-2',
      data: { uiScale: { density: 'large' } },
      targetDevice: { deviceId: 'dev-2' }
    })
    await expect(restrictDeviceSelfPatch(context)).rejects.toThrowError(Forbidden)
  })

  it('externer Call: verbotenes Feld → Forbidden mit Policy-Message', async () => {
    const context = makeContext({
      provider: 'socketio',
      user: posDeviceUser,
      id: 'rec-1',
      data: { apiKeyId: 'key-2' },
      targetDevice: { deviceId: 'dev-1' }
    })
    await expect(restrictDeviceSelfPatch(context)).rejects.toThrowError(
      "Feld 'apiKeyId' kann nicht im Geraete-Self-Service geaendert werden. Erlaubt: uiScale."
    )
  })

  it('externer Call: Multi-Patch (id null) → Forbidden', async () => {
    const context = makeContext({
      provider: 'socketio',
      user: posDeviceUser,
      id: null,
      data: { uiScale: { density: 'large' } }
    })
    await expect(restrictDeviceSelfPatch(context)).rejects.toThrowError(Forbidden)
  })

  it('deviceId-Fallback aus authentication.payload greift', async () => {
    const context = makeContext({
      provider: 'socketio',
      user: { _id: 'irgendwas', role: 'device:pos-client', tenantId: 't-1', locationId: 'loc-1' },
      authentication: { strategy: 'apiKey', payload: { deviceId: 'dev-1' } },
      id: 'rec-1',
      data: { uiScale: { density: 'default' } },
      targetDevice: { deviceId: 'dev-1' }
    })
    await expect(restrictDeviceSelfPatch(context)).resolves.toBe(context)
  })

  it('privilegierte Rolle → Bypass ohne Ownership-Lookup', async () => {
    const context = makeContext({
      provider: 'rest',
      user: { _id: 'user-1', role: 'tenant:owner', tenantId: 't-1' },
      id: 'rec-2',
      data: { name: 'Kasse 2', active: false },
      targetDevice: { deviceId: 'dev-2' }
    })
    await expect(restrictDeviceSelfPatch(context)).resolves.toBe(context)
  })
})

describe('Matrix-Sync (Regressionsanker)', () => {
  it('DEVICE_PRIVILEGED_ROLES = Rollen mit devices:MANAGE laut Matrix + PLATFORM_OWNER', () => {
    const manageRoles = Object.entries(RolePermissions)
      .filter(([, rules]) =>
        rules.some(
          rule =>
            typeof rule === 'object' &&
            'resource' in rule &&
            rule.resource === AppResource.DEVICES &&
            (Array.isArray(rule.action) ? rule.action : [rule.action]).includes(AppAction.MANAGE)
        )
      )
      .map(([role]) => role)

    const expected = new Set<string>([...manageRoles, UserSystemRole.PLATFORM_OWNER])
    expect([...DEVICE_PRIVILEGED_ROLES].sort()).toEqual([...expected].sort())
  })

  it('DEVICE_POS hat devices:READ+UPDATE, aber niemals MANAGE/DELETE', () => {
    const deviceRules = RolePermissions[UserSystemRole.DEVICE_POS].filter(
      rule => typeof rule === 'object' && 'resource' in rule && rule.resource === AppResource.DEVICES
    )
    const actions = deviceRules.flatMap(rule =>
      typeof rule === 'object' && 'action' in rule
        ? Array.isArray(rule.action)
          ? rule.action
          : [rule.action]
        : []
    )
    expect(actions.sort()).toEqual([AppAction.READ, AppAction.UPDATE].sort())
  })
})
