import { describe, expect, it } from 'vitest'

import { classifyOutboxError } from './outbox'

/**
 * Gegenstueck zu `apps/api-edge/src/hooks/require-device-reverification.hook.ts`
 * (panary/panary-core#325): Der Edge weist Schreibzugriffe eines Geraets mit
 * ausstehender Bestaetigung per 503 ab. Stuefte die Outbox das als `terminal`
 * ein, waere jede offline erfasste Bestellung dieses Terminals verloren — nicht
 * verzoegert, sondern geloescht (`markRejected`).
 *
 * Diese Spec locket den Zusammenhang dort, wo der Klassifizierer lebt: Der
 * Hook-Test kann `@panary/shared/offline-cache` nicht importieren, weil dessen
 * Barrel Angular mitzieht.
 */
describe('classifyOutboxError() — Abgrenzung terminal/transient', () => {
  it.each([400, 401, 403, 422])('stuft %i als terminal ein (Eintrag wird verworfen)', code => {
    expect(classifyOutboxError({ code })).toBe('terminal')
  })

  it('stuft 503 als transient ein — der Re-Verifikations-Code von #325', () => {
    expect(classifyOutboxError({ code: 503 })).toBe('transient')
  })

  it('stuft 409 als already-exists ein', () => {
    expect(classifyOutboxError({ code: 409 })).toBe('already-exists')
  })

  it('faellt bei unbekannten Fehlern auf transient zurueck', () => {
    expect(classifyOutboxError(new Error('boom'))).toBe('transient')
    expect(classifyOutboxError(null)).toBe('transient')
  })
})
