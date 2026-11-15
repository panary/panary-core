import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { syncHeartbeatResponseSchema } from './sync-heartbeat.schema'

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
