import { describe, expect, it } from 'vitest'

import { MAX_CLIENT_VERSION_LENGTH, readClientVersion } from './device-client-version'

describe('readClientVersion', () => {
  it('übernimmt einen Stand im Format YY.MM.INDEX unverändert', () => {
    expect(readClientVersion('26.11.15')).toBe('26.11.15')
  })

  it('übernimmt auch Staging-Tags: Die Auswertung entscheidet später, ob sie verwertbar sind', () => {
    expect(readClientVersion('staging-ab12cd3')).toBe('staging-ab12cd3')
  })

  it('schneidet umgebende Leerzeichen ab', () => {
    expect(readClientVersion('  26.11.15 ')).toBe('26.11.15')
  })

  it.each([undefined, null, 26.11, 2611, true, {}, ['26.11.15']])('liest %j als unbekannt', value => {
    expect(readClientVersion(value)).toBeNull()
  })

  it.each(['', '   '])('liest den leeren Text %j als unbekannt', value => {
    expect(readClientVersion(value)).toBeNull()
  })

  it('nimmt genau die Höchstlänge noch an', () => {
    const value = 'a'.repeat(MAX_CLIENT_VERSION_LENGTH)
    expect(readClientVersion(value)).toBe(value)
  })

  it('liest einen Wert über der Höchstlänge als unbekannt, ohne ihn zu kürzen', () => {
    expect(readClientVersion('a'.repeat(MAX_CLIENT_VERSION_LENGTH + 1))).toBeNull()
  })
})
