import { describe, expect, it } from 'vitest'
import { evaluatePosVersion, versionBlocksStart } from './pos-version-policy'

describe('evaluatePosVersion', () => {
  it('ohne Mindestversion ist der Start immer erlaubt', () => {
    for (const requiredPosMinVersion of [null, undefined, '']) {
      const verdict = evaluatePosVersion({ posVersion: '26.8.1', edgeVersion: '26.11.19', requiredPosMinVersion })
      expect(verdict.belowMinimum).toBe(false)
      expect(versionBlocksStart(verdict, false)).toBe(false)
    }
  })

  it('unter der Mindestversion ist belowMinimum gesetzt, auch nur um einen Index', () => {
    expect(
      evaluatePosVersion({ posVersion: '26.11.18', edgeVersion: '26.11.19', requiredPosMinVersion: '26.11.19' })
        .belowMinimum,
    ).toBe(true)
    expect(
      evaluatePosVersion({ posVersion: '26.10.30', edgeVersion: '26.11.19', requiredPosMinVersion: '26.11.1' })
        .belowMinimum,
    ).toBe(true)
  })

  it('auf oder über der Mindestversion ist nichts gesperrt', () => {
    expect(
      evaluatePosVersion({ posVersion: '26.11.19', edgeVersion: '26.11.19', requiredPosMinVersion: '26.11.19' })
        .belowMinimum,
    ).toBe(false)
    expect(
      evaluatePosVersion({ posVersion: 'v26.12.2', edgeVersion: '26.11.19', requiredPosMinVersion: '26.11.19' })
        .belowMinimum,
    ).toBe(false)
  })

  it('warnt ab einem Monatsstand Rückstand hinter dem Edge, nicht im selben Monat', () => {
    const base = { requiredPosMinVersion: null }
    expect(evaluatePosVersion({ ...base, posVersion: '26.11.1', edgeVersion: '26.11.19' }).behindEdge).toBe(false)
    expect(evaluatePosVersion({ ...base, posVersion: '26.10.30', edgeVersion: '26.11.1' }).behindEdge).toBe(true)
    expect(evaluatePosVersion({ ...base, posVersion: '26.8.4', edgeVersion: '26.11.19' })).toMatchObject({
      behindEdge: true,
      monthsBehindEdge: 3,
    })
  })

  it('ein POS, der neuer ist als der Edge, warnt nicht', () => {
    const verdict = evaluatePosVersion({ posVersion: '26.12.1', edgeVersion: '26.11.19', requiredPosMinVersion: null })
    expect(verdict.behindEdge).toBe(false)
    expect(verdict.monthsBehindEdge).toBe(-1)
  })

  it('nicht prüfbare Werte warnen nie und sperren nie', () => {
    const unknowns = ['staging-ab12cd3', '0.0.0', 'pr-check', '', null, undefined]
    for (const unknown of unknowns) {
      for (const verdict of [
        evaluatePosVersion({ posVersion: unknown, edgeVersion: '26.11.19', requiredPosMinVersion: '26.11.19' }),
        evaluatePosVersion({ posVersion: '26.8.1', edgeVersion: unknown, requiredPosMinVersion: unknown }),
      ]) {
        expect(verdict.belowMinimum).toBe(false)
        expect(verdict.behindEdge).toBe(false)
      }
    }
  })
})

describe('versionBlocksStart', () => {
  const below = evaluatePosVersion({ posVersion: '26.8.1', edgeVersion: '26.11.19', requiredPosMinVersion: '26.11.1' })

  it('verweigert unter der Mindestversion ohne offene Kassensitzung', () => {
    expect(versionBlocksStart(below, false)).toBe(true)
  })

  it('lässt mit offener Kassensitzung durch, auch unter der Mindestversion', () => {
    expect(versionBlocksStart(below, true)).toBe(false)
  })

  it('lässt ohne Mindestversion immer durch', () => {
    const open = evaluatePosVersion({ posVersion: '26.8.1', edgeVersion: '26.11.19', requiredPosMinVersion: null })
    expect(versionBlocksStart(open, false)).toBe(false)
  })
})
