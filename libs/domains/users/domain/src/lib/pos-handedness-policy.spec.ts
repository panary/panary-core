import { describe, expect, it } from 'vitest'

import { DEFAULT_POS_HANDEDNESS, resolvePosHandedness } from './pos-handedness-policy'
import { PosHandedness } from './user.schema'

describe('resolvePosHandedness', () => {
  it('Default ist links — Warenkorb-Position wie vor dem Feld (Entscheidung core#819)', () => {
    expect(DEFAULT_POS_HANDEDNESS).toBe('left')
  })

  it.each([PosHandedness.LEFT, PosHandedness.RIGHT])('uebernimmt gesetzten Wert %s', value => {
    expect(resolvePosHandedness({ posHandedness: value })).toBe(value)
  })

  // null = leere SQLite-Spalte, undefined = Sitzungs-Record von vor dem Update.
  it.each([undefined, null, '', 'links', 'RIGHT', 1])('faellt bei %j auf links zurueck', value => {
    expect(resolvePosHandedness({ posHandedness: value })).toBe(PosHandedness.LEFT)
  })

  it('faellt ohne User auf links zurueck', () => {
    expect(resolvePosHandedness(undefined)).toBe(PosHandedness.LEFT)
    expect(resolvePosHandedness(null)).toBe(PosHandedness.LEFT)
    expect(resolvePosHandedness({})).toBe(PosHandedness.LEFT)
  })
})
