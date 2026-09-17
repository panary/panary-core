import { APIKEY_TTL_DAYS } from '@panary/apikeys/domain'
import { describe, expect, it } from 'vitest'

import { apikeyDataResolver, apikeyPatchResolver } from './apikeys.schema'

import type { HookContext } from '../../declarations'

// API-Keys sind nach der Erstellung unveraenderlich — Ausnahmen sind genau
// drei, und jede hat ihre eigene, engere Weiche:
//   `active`               extern toggelbar (das Sperrmittel)
//   `lastUsedAt`           nur serverseitige Telemetrie (utils/apikey-last-used.ts)
//   Rotations-Felder       nur der Rotations-Pfad (utils/device-apikey-auth.ts,
//                          `provider: undefined` UND `_apikeyRotation: true`)
// Dieser Test ist der Anker gegen eine spaetere Aufweichung: Weder die
// Provider-Weiche bei `lastUsedAt` noch der Rotations-Marker duerfen als
// Praezedenzfall fuer `role`, `deviceId`, `name` oder `tenantId` gelesen werden.
const makeContext = (provider?: string, rotation = false): HookContext =>
  ({
    params: { provider, _apikeyRotation: rotation },
  }) as unknown as HookContext

/** Ein PATCH, der jedes Feld des Schemas zu setzen versucht. */
const fullPatch = {
  _id: 'fremd-id',
  tenantId: 'fremder-tenant',
  locationId: 'fremde-location',
  apikey: 'gefaelschter-hash',
  apikeyPrefix: 'abcdefgh',
  pendingApikey: 'gefaelschter-pending-hash',
  pendingApikeyPrefix: 'hgfedcba',
  pendingApikeyCreatedAt: '2026-07-31T12:00:00.000Z',
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

/** Felder, die auf JEDEM Weg verworfen werden — auch im Rotations-Pfad. */
const ALWAYS_LOCKED = [
  '_id',
  'tenantId',
  'locationId',
  'name',
  'description',
  'role',
  'deviceId',
  'createdBy',
  'createdAt',
] as const

/** Felder, die ausschliesslich der Rotations-Pfad setzen darf. */
const ROTATION_ONLY = [
  'apikey',
  'apikeyPrefix',
  'pendingApikey',
  'pendingApikeyPrefix',
  'pendingApikeyCreatedAt',
  'validUntil',
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

  it.each(['rest', 'socketio', undefined])('sperrt die unveraenderlichen Felder (provider: %s)', async provider => {
    const resolved = (await apikeyPatchResolver.resolve(fullPatch as never, makeContext(provider))) as Record<
      string,
      unknown
    >
    for (const field of ALWAYS_LOCKED) {
      expect(resolved[field], `${field} darf per PATCH nicht setzbar sein`).toBeUndefined()
    }
  })

  it('sperrt die unveraenderlichen Felder auch im Rotations-Pfad', async () => {
    const resolved = (await apikeyPatchResolver.resolve(fullPatch as never, makeContext(undefined, true))) as Record<
      string,
      unknown
    >
    for (const field of ALWAYS_LOCKED) {
      expect(resolved[field], `${field} darf auch bei der Rotation nicht setzbar sein`).toBeUndefined()
    }
  })

  it.each(['rest', 'socketio'])('verwirft Credential-Material bei einem externen PATCH (%s)', async provider => {
    const resolved = (await apikeyPatchResolver.resolve(fullPatch as never, makeContext(provider))) as Record<
      string,
      unknown
    >
    for (const field of ROTATION_ONLY) {
      expect(resolved[field], `${field} darf extern nicht setzbar sein`).toBeUndefined()
    }
  })

  it('verwirft Credential-Material auch bei einem internen PATCH OHNE Rotations-Marker', async () => {
    // Der Marker ist der eigentliche Schutz: „intern" allein genuegt nicht,
    // sonst waere jeder serverseitige Patch-Pfad ein Weg, ein Geraet auszutauschen.
    const resolved = (await apikeyPatchResolver.resolve(fullPatch as never, makeContext(undefined))) as Record<
      string,
      unknown
    >
    for (const field of ROTATION_ONLY) {
      expect(resolved[field], `${field} darf ohne Rotations-Marker nicht setzbar sein`).toBeUndefined()
    }
  })

  it('laesst Credential-Material im Rotations-Pfad durch', async () => {
    const resolved = (await apikeyPatchResolver.resolve(fullPatch as never, makeContext(undefined, true))) as Record<
      string,
      unknown
    >
    expect(resolved.apikey).toBe('gefaelschter-hash')
    expect(resolved.pendingApikey).toBe('gefaelschter-pending-hash')
    expect(resolved.validUntil).toBe('2099-01-01T00:00:00.000Z')
  })

  it('laesst die Rotations-Felder auf null durch — Promotion muss sie LEEREN koennen', async () => {
    // `undefined` liesse die Spalte unveraendert stehen; der alte pending-Hash
    // bliebe gueltig und der Schluessel waere doppelt vergeben.
    const resolved = (await apikeyPatchResolver.resolve(
      { pendingApikey: null, pendingApikeyPrefix: null, pendingApikeyCreatedAt: null } as never,
      makeContext(undefined, true),
    )) as Record<string, unknown>
    expect(resolved.pendingApikey).toBeNull()
    expect(resolved.pendingApikeyPrefix).toBeNull()
    expect(resolved.pendingApikeyCreatedAt).toBeNull()
  })

  it('laesst active durch und stempelt updatedAt serverseitig', async () => {
    const resolved = await apikeyPatchResolver.resolve(fullPatch as never, makeContext('rest'))
    expect(resolved.active).toBe(false)
    expect(resolved.updatedAt).not.toBe(fullPatch.createdAt)
    expect(typeof resolved.updatedAt).toBe('string')
  })
})

describe('apikeyDataResolver — validUntil beim Anlegen', () => {
  const createContext = (): HookContext =>
    ({
      params: {},
      app: { service: () => ({ get: async () => ({ type: 'pos-counter' }) }) },
    }) as unknown as HookContext

  const DAY_MS = 24 * 60 * 60 * 1000

  it('befristet einen Geraete-Schluessel auf die TTL', async () => {
    const before = Date.now()
    const resolved = await apikeyDataResolver.resolve(
      { name: 'POS API Key', deviceId: 'geraet-1' } as never,
      createContext(),
    )

    const validUntil = new Date(resolved.validUntil as string).getTime()
    expect(validUntil).toBeGreaterThanOrEqual(before + APIKEY_TTL_DAYS * DAY_MS - 5_000)
    expect(validUntil).toBeLessThanOrEqual(Date.now() + APIKEY_TTL_DAYS * DAY_MS + 5_000)
  })

  it('laesst einen Integrations-Schluessel ohne deviceId unbefristet', async () => {
    // Ohne Geraet gibt es keinen Rotationspfad — eine Befristung waere hier ein
    // Fallbeil ohne Ausweg, genau das, was ADR 0042 vermeidet.
    const resolved = await apikeyDataResolver.resolve({ name: 'Integration' } as never, createContext())
    expect(resolved.validUntil).toBeUndefined()
  })

  it('respektiert ein ausdruecklich gesetztes validUntil', async () => {
    const resolved = await apikeyDataResolver.resolve(
      { name: 'POS API Key', deviceId: 'geraet-1', validUntil: '2030-01-01T00:00:00.000Z' } as never,
      createContext(),
    )
    expect(resolved.validUntil).toBe('2030-01-01T00:00:00.000Z')
  })
})
