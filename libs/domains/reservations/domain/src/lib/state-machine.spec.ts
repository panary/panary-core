import { describe, expect, it } from 'vitest'

import { allowedTransitionsFrom, assertValidTransition, isValidTransition } from './state-machine'

describe('reservation state-machine — assertValidTransition (D-24)', () => {
  describe('happy path — erlaubte Transitions', () => {
    it('pending → confirmed', () => {
      expect(() => assertValidTransition('pending', 'confirmed')).not.toThrow()
    })

    it('pending → cancelled', () => {
      expect(() => assertValidTransition('pending', 'cancelled')).not.toThrow()
    })

    it('confirmed → cancelled', () => {
      expect(() => assertValidTransition('confirmed', 'cancelled')).not.toThrow()
    })

    it('confirmed → no-show', () => {
      expect(() => assertValidTransition('confirmed', 'no-show')).not.toThrow()
    })
  })

  describe('forbidden — terminal states', () => {
    it('cancelled → confirmed wirft', () => {
      expect(() => assertValidTransition('cancelled', 'confirmed')).toThrow(/cancelled → confirmed/)
    })

    it('cancelled → pending wirft', () => {
      expect(() => assertValidTransition('cancelled', 'pending')).toThrow()
    })

    it('cancelled → no-show wirft', () => {
      expect(() => assertValidTransition('cancelled', 'no-show')).toThrow()
    })

    it('no-show → confirmed wirft', () => {
      expect(() => assertValidTransition('no-show', 'confirmed')).toThrow()
    })

    it('no-show → pending wirft', () => {
      expect(() => assertValidTransition('no-show', 'pending')).toThrow()
    })

    it('no-show → cancelled wirft', () => {
      expect(() => assertValidTransition('no-show', 'cancelled')).toThrow()
    })
  })

  describe('forbidden — pending darf nicht direkt zu no-show springen', () => {
    it('pending → no-show wirft (Pflicht über confirmed)', () => {
      expect(() => assertValidTransition('pending', 'no-show')).toThrow(/pending → no-show/)
    })
  })

  describe('forbidden — Self-Transitions sind keine Transitions', () => {
    it('pending → pending wirft', () => {
      expect(() => assertValidTransition('pending', 'pending')).toThrow()
    })

    it('confirmed → confirmed wirft', () => {
      expect(() => assertValidTransition('confirmed', 'confirmed')).toThrow()
    })
  })

  describe('forbidden — Unbekannter Quell-Status', () => {
    it('invalid → confirmed wirft', () => {
      expect(() => assertValidTransition('invalid', 'confirmed')).toThrow()
    })
  })
})

describe('isValidTransition — Boolean-Variante', () => {
  it('liefert true für pending → confirmed', () => {
    expect(isValidTransition('pending', 'confirmed')).toBe(true)
  })

  it('liefert false für cancelled → confirmed', () => {
    expect(isValidTransition('cancelled', 'confirmed')).toBe(false)
  })

  it('liefert false für unbekannten Quell-Status', () => {
    expect(isValidTransition('unknown', 'pending')).toBe(false)
  })
})

describe('allowedTransitionsFrom', () => {
  it('pending hat 2 erlaubte Ziele', () => {
    expect(allowedTransitionsFrom('pending')).toEqual(['confirmed', 'cancelled'])
  })

  it('confirmed hat 2 erlaubte Ziele', () => {
    expect(allowedTransitionsFrom('confirmed')).toEqual(['cancelled', 'no-show'])
  })

  it('cancelled hat keine erlaubten Ziele (terminal)', () => {
    expect(allowedTransitionsFrom('cancelled')).toEqual([])
  })

  it('no-show hat keine erlaubten Ziele (terminal)', () => {
    expect(allowedTransitionsFrom('no-show')).toEqual([])
  })

  it('unbekannter Quell-Status → leere Liste', () => {
    expect(allowedTransitionsFrom('foobar')).toEqual([])
  })
})
