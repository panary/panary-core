import { describe, expect, it } from 'vitest'

import {
  APIKEY_GRACE_DAYS,
  APIKEY_PENDING_STALE_DAYS,
  APIKEY_ROTATION_LEAD_DAYS,
  APIKEY_TTL_DAYS,
  ApikeyLifecycleState,
  evaluateApikeyLifecycle,
  isPendingApikeyStale,
  nextApikeyValidUntil,
} from './apikey-lifecycle'

const NOW = Date.parse('2026-09-17T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const inDays = (days: number): string => new Date(NOW + days * DAY_MS).toISOString()

describe('evaluateApikeyLifecycle', () => {
  it('behandelt einen Bestands-Key ohne validUntil als unbefristet und stempelbar', () => {
    const result = evaluateApikeyLifecycle(undefined, NOW)
    expect(result.state).toBe(ApikeyLifecycleState.UNSTAMPED)
    expect(result.accepted).toBe(true)
    expect(result.rotationDue).toBe(false)
    expect(result.remainingMs).toBeNull()
  })

  it('behandelt ein unlesbares validUntil wie „nie gesetzt" statt als Ablehnung', () => {
    // Ein kaputter Wert darf ein Geraet nicht aussperren — der Stempel repariert ihn.
    expect(evaluateApikeyLifecycle('kein-datum', NOW).state).toBe(ApikeyLifecycleState.UNSTAMPED)
    expect(evaluateApikeyLifecycle('kein-datum', NOW).accepted).toBe(true)
  })

  it('laesst einen frischen Key ohne Rotation durch', () => {
    const result = evaluateApikeyLifecycle(inDays(APIKEY_TTL_DAYS), NOW)
    expect(result.state).toBe(ApikeyLifecycleState.VALID)
    expect(result.rotationDue).toBe(false)
  })

  it('loest die Rotation aus, sobald die Restlaufzeit den Lead unterschreitet', () => {
    const result = evaluateApikeyLifecycle(inDays(APIKEY_ROTATION_LEAD_DAYS - 1), NOW)
    expect(result.state).toBe(ApikeyLifecycleState.ROTATE)
    expect(result.accepted).toBe(true)
    expect(result.rotationDue).toBe(true)
  })

  it('rotiert auf der Lead-Grenze selbst noch NICHT — erst beim Unterschreiten', () => {
    expect(evaluateApikeyLifecycle(inDays(APIKEY_ROTATION_LEAD_DAYS), NOW).state).toBe(ApikeyLifecycleState.VALID)
  })

  it('akzeptiert einen abgelaufenen Key innerhalb der Karenz und erzwingt die Rotation', () => {
    const result = evaluateApikeyLifecycle(inDays(-1), NOW)
    expect(result.state).toBe(ApikeyLifecycleState.GRACE)
    expect(result.accepted).toBe(true)
    expect(result.rotationDue).toBe(true)
    expect(result.remainingMs).toBeLessThan(0)
  })

  it('akzeptiert bis kurz vor dem Karenz-Ende', () => {
    const result = evaluateApikeyLifecycle(inDays(-APIKEY_GRACE_DAYS + 1), NOW)
    expect(result.state).toBe(ApikeyLifecycleState.GRACE)
    expect(result.accepted).toBe(true)
  })

  it('lehnt jenseits der Karenz ab', () => {
    const result = evaluateApikeyLifecycle(inDays(-APIKEY_GRACE_DAYS - 1), NOW)
    expect(result.state).toBe(ApikeyLifecycleState.EXPIRED)
    expect(result.accepted).toBe(false)
    expect(result.rotationDue).toBe(false)
  })

  it('haelt die Reihenfolge der Schwellen ein — sonst verschluckt eine die andere', () => {
    expect(APIKEY_ROTATION_LEAD_DAYS).toBeLessThan(APIKEY_TTL_DAYS)
    expect(APIKEY_GRACE_DAYS).toBeGreaterThan(0)
  })
})

describe('nextApikeyValidUntil', () => {
  it('liegt genau die TTL in der Zukunft', () => {
    expect(nextApikeyValidUntil(NOW)).toBe(inDays(APIKEY_TTL_DAYS))
  })

  it('erzeugt einen Wert, der sofort als VALID bewertet wird', () => {
    expect(evaluateApikeyLifecycle(nextApikeyValidUntil(NOW), NOW).state).toBe(ApikeyLifecycleState.VALID)
  })
})

describe('isPendingApikeyStale', () => {
  it('gilt ohne Zeitstempel als veraltet — Bestand aus einer Version ohne das Feld', () => {
    expect(isPendingApikeyStale(undefined, NOW)).toBe(true)
    expect(isPendingApikeyStale(null, NOW)).toBe(true)
    expect(isPendingApikeyStale('kein-datum', NOW)).toBe(true)
  })

  it('gilt frisch ausgestellt als nicht veraltet', () => {
    expect(isPendingApikeyStale(inDays(-1), NOW)).toBe(false)
  })

  it('gilt jenseits der Frist als veraltet', () => {
    expect(isPendingApikeyStale(inDays(-APIKEY_PENDING_STALE_DAYS - 1), NOW)).toBe(true)
  })
})
