import { describe, expect, it } from 'vitest'

import { OrderStatus } from './order.schema'
import { assertValidOrderStatusTransition, isValidOrderStatusTransition } from './order-state-machine'

describe('order state-machine — assertValidOrderStatusTransition (Security „order-status-fsm")', () => {
  describe('erlaubte Vorwärts-Übergänge (bewusst permissiv — kein Kassenausfall)', () => {
    const forward: Array<[string, string]> = [
      [OrderStatus.ACTIVE, OrderStatus.PRODUCTION],
      [OrderStatus.ACTIVE, OrderStatus.COMPLETED], // Direkt-Sprung (Frontend setzt teils direkt)
      [OrderStatus.PRODUCTION, OrderStatus.PRODUCED],
      [OrderStatus.PRODUCTION, OrderStatus.COMPLETED],
      [OrderStatus.PRODUCED, OrderStatus.COMPLETED],
      [OrderStatus.ACTIVE, OrderStatus.ABORTED], // Storno vor Produktion
      [OrderStatus.PRODUCED, OrderStatus.ABORTED],
      [OrderStatus.UNCLAIMED, OrderStatus.COMPLETED], // Kunde erscheint doch
      [OrderStatus.UNCLAIMED, OrderStatus.ABORTED],
    ]
    for (const [from, to] of forward) {
      it(`${from} → ${to}`, () => {
        expect(() => assertValidOrderStatusTransition(from, to)).not.toThrow()
      })
    }
  })

  describe('erlaubte Terminal-Exits (dokumentierte, code-gestützte Flows)', () => {
    it('COMPLETED → UNCLAIMED (TTL-Nichtabholung)', () => {
      expect(() => assertValidOrderStatusTransition(OrderStatus.COMPLETED, OrderStatus.UNCLAIMED)).not.toThrow()
    })

    it('COMPLETED → ABORTED (nachträglicher Storno/Refund → Reversal + TSE-Storno)', () => {
      expect(() => assertValidOrderStatusTransition(OrderStatus.COMPLETED, OrderStatus.ABORTED)).not.toThrow()
    })
  })

  describe('erlaubte Same-Status-Patches (interne Marker / idempotent)', () => {
    for (const status of Object.values(OrderStatus)) {
      it(`${status} → ${status}`, () => {
        expect(() => assertValidOrderStatusTransition(status, status)).not.toThrow()
      })
    }
  })

  describe('verbotene Rücksprünge aus COMPLETED (fiskalischer Bon-Reopen)', () => {
    const illegal: Array<[string, string]> = [
      [OrderStatus.COMPLETED, OrderStatus.ACTIVE],
      [OrderStatus.COMPLETED, OrderStatus.PRODUCTION],
      [OrderStatus.COMPLETED, OrderStatus.PRODUCED],
    ]
    for (const [from, to] of illegal) {
      it(`${from} → ${to} wirft`, () => {
        expect(() => assertValidOrderStatusTransition(from, to)).toThrow(/Ungültiger Order-Status-Übergang/)
      })
    }
  })

  describe('verbotene Übergänge aus ABORTED (Storno ist endgültig)', () => {
    const illegal: Array<[string, string]> = [
      [OrderStatus.ABORTED, OrderStatus.COMPLETED],
      [OrderStatus.ABORTED, OrderStatus.ACTIVE],
      [OrderStatus.ABORTED, OrderStatus.PRODUCTION],
      [OrderStatus.ABORTED, OrderStatus.PRODUCED],
      [OrderStatus.ABORTED, OrderStatus.UNCLAIMED],
    ]
    for (const [from, to] of illegal) {
      it(`${from} → ${to} wirft`, () => {
        expect(() => assertValidOrderStatusTransition(from, to)).toThrow()
      })
    }
  })
})

describe('isValidOrderStatusTransition — Boolean-Variante', () => {
  it('true für PRODUCED → COMPLETED', () => {
    expect(isValidOrderStatusTransition(OrderStatus.PRODUCED, OrderStatus.COMPLETED)).toBe(true)
  })

  it('true für COMPLETED → ABORTED', () => {
    expect(isValidOrderStatusTransition(OrderStatus.COMPLETED, OrderStatus.ABORTED)).toBe(true)
  })

  it('false für ABORTED → COMPLETED', () => {
    expect(isValidOrderStatusTransition(OrderStatus.ABORTED, OrderStatus.COMPLETED)).toBe(false)
  })

  it('false für COMPLETED → ACTIVE', () => {
    expect(isValidOrderStatusTransition(OrderStatus.COMPLETED, OrderStatus.ACTIVE)).toBe(false)
  })

  it('true für Same-Status COMPLETED → COMPLETED', () => {
    expect(isValidOrderStatusTransition(OrderStatus.COMPLETED, OrderStatus.COMPLETED)).toBe(true)
  })
})
