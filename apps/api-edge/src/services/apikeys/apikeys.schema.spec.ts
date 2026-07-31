import { describe, expect, it } from 'vitest'

import { apikeyPatchResolver } from './apikeys.schema'

import type { HookContext } from '../../declarations'

// API-Keys sind nach der Erstellung unveraenderlich — einzige Ausnahmen:
// `active` (extern toggelbar) und `lastUsedAt` (nur serverseitige Telemetrie,
// gestempelt von utils/apikey-last-used.ts). Dieser Test ist der Anker gegen
// eine spaetere Aufweichung: die Provider-Weiche bei `lastUsedAt` darf nicht
// als Praezedenzfall fuer `role`, `deviceId` oder `apikey` gelesen werden.
const makeContext = (provider?: string): HookContext =>
  ({
    params: { provider },
  }) as unknown as HookContext

/** Ein PATCH, der jedes Feld des Schemas zu setzen versucht. */
const fullPatch = {
  _id: 'fremd-id',
  tenantId: 'fremder-tenant',
  locationId: 'fremde-location',
  apikey: 'gefaelschter-hash',
  apikeyPrefix: 'abcdefgh',
  name: 'Umbenannt',
  description: 'Neue Beschreibung',
  role: 'platform:owner',
  validUntil: '2099-01-01T00:00:00.000Z',
  deviceId: 'fremdes-geraet',
  createdBy: 'jemand-anderes',
  lastUsedAt: '2026-07-31T12:00:00.000Z',
  active: false,
  createdAt: '2000-01-01T00:00:00.000Z',
}

/** Alles ausser `active`, `lastUsedAt` und `updatedAt` muss immer verworfen werden. */
const ALWAYS_LOCKED = [
  '_id',
  'tenantId',
  'locationId',
  'apikey',
  'apikeyPrefix',
  'name',
  'description',
  'role',
  'validUntil',
  'deviceId',
  'createdBy',
  'createdAt',
] as const

describe('apikeyPatchResolver', () => {
  it('verwirft lastUsedAt bei einem externen PATCH', async () => {
    const resolved = await apikeyPatchResolver.resolve(fullPatch as never, makeContext('rest'))
    expect(resolved.lastUsedAt).toBeUndefined()
  })

  it('laesst lastUsedAt bei einem internen PATCH durch', async () => {
    const resolved = await apikeyPatchResolver.resolve(fullPatch as never, makeContext(undefined))
    expect(resolved.lastUsedAt).toBe('2026-07-31T12:00:00.000Z')
  })

  it.each(['rest', 'socketio', undefined])('sperrt alle uebrigen Felder (provider: %s)', async provider => {
    const resolved = (await apikeyPatchResolver.resolve(fullPatch as never, makeContext(provider))) as Record<
      string,
      unknown
    >
    for (const field of ALWAYS_LOCKED) {
      expect(resolved[field], `${field} darf per PATCH nicht setzbar sein`).toBeUndefined()
    }
  })

  it('laesst active durch und stempelt updatedAt serverseitig', async () => {
    const resolved = await apikeyPatchResolver.resolve(fullPatch as never, makeContext('rest'))
    expect(resolved.active).toBe(false)
    expect(resolved.updatedAt).not.toBe(fullPatch.createdAt)
    expect(typeof resolved.updatedAt).toBe('string')
  })
})
