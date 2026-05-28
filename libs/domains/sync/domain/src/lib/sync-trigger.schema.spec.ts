import { beforeAll, describe, expect, it } from 'vitest'

import { FormatRegistry } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

import { edgeForceSyncEventSchema } from './edge-event.schema'
import {
  syncTriggerRequestSchema,
  syncTriggerResponseSchema,
  SyncTriggerErrorCode,
  SyncTriggerScope,
} from './sync-trigger.schema'

// TypeBox liefert keine eingebauten Format-Validatoren — in der Feathers-App
// uebernimmt AJV das. Fuer Value.Check muessen wir die Formate, die unsere
// Schemas verwenden, lokal registrieren. Das erlaubt Schema-Roundtrip-Tests
// ohne Feathers-Boot.
beforeAll(() => {
  if (!FormatRegistry.Has('uuid')) {
    FormatRegistry.Set('uuid', value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
  }
  if (!FormatRegistry.Has('date-time')) {
    FormatRegistry.Set('date-time', value => !Number.isNaN(Date.parse(value)))
  }
})

describe('syncTriggerRequestSchema', () => {
  it('akzeptiert minimalen Request (nur cloudEdgeId)', () => {
    const data = { cloudEdgeId: '12345678-1234-4234-8234-123456789001' }
    expect(Value.Check(syncTriggerRequestSchema, data)).toBe(true)
  })

  it('akzeptiert Request mit explizitem scope', () => {
    const data = {
      cloudEdgeId: '12345678-1234-4234-8234-123456789001',
      scope: SyncTriggerScope.FULL_CYCLE,
    }
    expect(Value.Check(syncTriggerRequestSchema, data)).toBe(true)
  })

  it('lehnt Request mit unbekanntem Feld ab (additionalProperties:false)', () => {
    const data = {
      cloudEdgeId: '12345678-1234-4234-8234-123456789001',
      forceAll: true,
    }
    expect(Value.Check(syncTriggerRequestSchema, data)).toBe(false)
  })

  it('lehnt Request ohne cloudEdgeId ab', () => {
    expect(Value.Check(syncTriggerRequestSchema, {})).toBe(false)
  })

  it('lehnt nicht-UUID-cloudEdgeId ab', () => {
    expect(Value.Check(syncTriggerRequestSchema, { cloudEdgeId: 'not-a-uuid' })).toBe(false)
  })
})

describe('syncTriggerResponseSchema', () => {
  it('akzeptiert vollstaendige Response', () => {
    const data = {
      ok: true,
      correlationId: '12345678-1234-4234-8234-123456789002',
      dispatchedAt: '2026-05-28T10:30:00.000Z',
      scope: SyncTriggerScope.FULL_CYCLE,
    }
    expect(Value.Check(syncTriggerResponseSchema, data)).toBe(true)
  })

  it('lehnt Response ohne correlationId ab', () => {
    const data = {
      ok: true,
      dispatchedAt: '2026-05-28T10:30:00.000Z',
      scope: SyncTriggerScope.FULL_CYCLE,
    }
    expect(Value.Check(syncTriggerResponseSchema, data)).toBe(false)
  })
})

describe('edgeForceSyncEventSchema — Rueckwaertskompatibilitaet', () => {
  // v1-Payload (nur cloudEdgeId) MUSS weiterhin gueltig sein, damit alte
  // emitEdgeForceSync-Caller den Schema-Check ueberleben.
  it('akzeptiert v1-Payload (nur cloudEdgeId)', () => {
    const data = { cloudEdgeId: '12345678-1234-4234-8234-123456789003' }
    expect(Value.Check(edgeForceSyncEventSchema, data)).toBe(true)
  })

  it('akzeptiert v2-Payload mit allen Feldern', () => {
    const data = {
      cloudEdgeId: '12345678-1234-4234-8234-123456789004',
      scope: SyncTriggerScope.FULL_CYCLE,
      requestedByUserId: '12345678-1234-4234-8234-123456789005',
      requestedAt: '2026-05-28T10:30:00.000Z',
      correlationId: '12345678-1234-4234-8234-123456789006',
    }
    expect(Value.Check(edgeForceSyncEventSchema, data)).toBe(true)
  })

  it('lehnt unbekannte Felder ab (additionalProperties:false bleibt scharf)', () => {
    const data = {
      cloudEdgeId: '12345678-1234-4234-8234-123456789007',
      forceAll: true,
    }
    expect(Value.Check(edgeForceSyncEventSchema, data)).toBe(false)
  })
})

describe('SyncTriggerErrorCode', () => {
  it('exportiert die erwarteten Codes (Frontend mapped sie auf UI-Texte)', () => {
    expect(SyncTriggerErrorCode.EDGE_NOT_FOUND).toBe('EDGE_NOT_FOUND')
    expect(SyncTriggerErrorCode.EDGE_REVOKED).toBe('EDGE_REVOKED')
    expect(SyncTriggerErrorCode.EDGE_UNREACHABLE).toBe('EDGE_UNREACHABLE')
    expect(SyncTriggerErrorCode.RATE_LIMITED).toBe('RATE_LIMITED')
    expect(SyncTriggerErrorCode.NOT_AUTHORIZED).toBe('NOT_AUTHORIZED')
  })
})
