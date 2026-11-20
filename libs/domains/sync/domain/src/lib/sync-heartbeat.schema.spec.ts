import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { syncHeartbeatRequestSchema, syncHeartbeatResponseSchema } from './sync-heartbeat.schema'

// Mit derselben AJV-Konfiguration wie der Feathers-`dataValidator`: `Value.Check` scheitert an StringEnum
// (Type.Unsafe), und `clockSkewStatus` ist ein Pflichtfeld der Antwort. Muster: device.schema.spec.ts.
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const validate = getValidator(syncHeartbeatResponseSchema, addFormats(new Ajv({}), formats))
const ok = async (data: unknown): Promise<boolean> => {
  try {
    await validate(data)
    return true
  } catch {
    return false
  }
}

// Mindestversionen reisen in der Heartbeat-Antwort zum Edge (ADR 0070, core#1437): der Edge liest sie dort
// schon heute, `/sync-status` ruft er nirgends auf. Beide Felder sind additiv und optional.
describe('syncHeartbeatResponseSchema — Mindestversionen (#1437)', () => {
  const basis = {
    serverTimestamp: '2026-11-15T19:00:00.000Z',
    clockSkewStatus: 'ok',
    clockSkewMs: 12,
  }

  it('akzeptiert die Antwort ohne Mindestversionen wie bisher', async () => {
    expect(await ok(basis)).toBe(true)
  })

  it('akzeptiert requiredEdgeMinVersion und requiredPosMinVersion', async () => {
    const antwort = { ...basis, requiredEdgeMinVersion: '26.9.1', requiredPosMinVersion: '26.10.1' }
    expect(await ok(antwort)).toBe(true)
  })

  it.each(['requiredEdgeMinVersion', 'requiredPosMinVersion'])('begrenzt %s auf 50 Zeichen', async feld => {
    expect(await ok({ ...basis, [feld]: 'x'.repeat(50) })).toBe(true)
    expect(await ok({ ...basis, [feld]: 'x'.repeat(51) })).toBe(false)
  })

  it.each(['requiredEdgeMinVersion', 'requiredPosMinVersion'])('lehnt für %s einen Nicht-String ab', async feld => {
    expect(await ok({ ...basis, [feld]: 2611 })).toBe(false)
  })

  it('bleibt geschlossen: ein unbekanntes Feld wird weiter abgelehnt', async () => {
    expect(await ok({ ...basis, requiredMinVersion: '26.9.1' })).toBe(false)
  })
})

// Zustand des Token-Schluessels (core#1508): nur ein Enum, nie ein Wert. Auf dem Heartbeat-Pfad ist das Schema kein
// Laufzeit-Gate, der Spec sichert Feldname und Literale gegen `TokenKeyStatus` in api-edge.
describe('syncHeartbeatRequestSchema — tokenKey (#1508)', () => {
  const validateRequest = getValidator(syncHeartbeatRequestSchema, addFormats(new Ajv({}), formats))
  const requestOk = async (data: unknown): Promise<boolean> => {
    try {
      await validateRequest(data)
      return true
    } catch {
      return false
    }
  }
  const basis = { edgeTimestamp: '2026-11-20T10:00:00.000Z', edgeClockMonotonicMs: 1000 }

  it('bleibt ohne tokenKey gueltig (Alt-Edges)', async () => {
    expect(await requestOk(basis)).toBe(true)
  })

  it.each(['missing', 'weak', 'ok'])('akzeptiert tokenKey %s', async wert => {
    expect(await requestOk({ ...basis, tokenKey: wert })).toBe(true)
  })

  it.each(['strong', 'OK', '', 32, null])('lehnt den Wert %j ab', async wert => {
    expect(await requestOk({ ...basis, tokenKey: wert })).toBe(false)
  })
})
