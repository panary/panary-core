import { describe, expect, it } from 'vitest'

import { compareVersions, isVersionDrift, monthsBehind, parsePanaryVersion } from './panary-version'

// Versionen sind `YY.MM.INDEX` (tools/scripts/bump-version.mjs), der Index springt im Monatswechsel auf 1.
// Die Fenster aus ADR 0070 sind in Monatsstaenden bemessen, nie in Releases.
describe('parsePanaryVersion', () => {
  it('zerlegt YY.MM.INDEX', () => {
    expect(parsePanaryVersion('26.11.15')).toEqual({ year: 26, month: 11, index: 15 })
    expect(parsePanaryVersion('26.9.30')).toEqual({ year: 26, month: 9, index: 30 })
  })

  it('nimmt das v des Tags und Leerraum an', () => {
    expect(parsePanaryVersion('v26.11.15')).toEqual({ year: 26, month: 11, index: 15 })
    expect(parsePanaryVersion(' 26.11.15\n')).toEqual({ year: 26, month: 11, index: 15 })
  })

  // Real vorkommende Nicht-Versionen: build-edge-docker.yml (`staging-<sha>`), Smoke- und PR-Check-Images,
  // der Platzhalter `0.0.0`. Sie duerfen nie als Rueckstand von Jahren erscheinen, sondern sind „unbekannt".
  it.each([
    'staging-ab12cd3',
    'staging-26.11.4',
    'pr-check',
    'smoke',
    '0.0.0',
    '1.2.3', // gewoehnliches Semver, kein Jahr
    '3.11.1',
    '',
    '   ',
    '26.11',
    '26.11.15.2',
    '26.11.15-rc1',
    '26.13.1',
    '26.0.1',
    '26.11.0',
    '2026.11.15',
    '26.-1.1',
    '26.11.x',
  ])('behandelt %j als unbekannt', eingabe => {
    expect(parsePanaryVersion(eingabe)).toBeNull()
  })

  it.each([undefined, null, 26.11, {}, [], true])('behandelt den Nicht-String %j als unbekannt', eingabe => {
    expect(parsePanaryVersion(eingabe)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('ordnet nach Jahr, Monat, Index', () => {
    expect(compareVersions('26.11.15', '26.11.15')).toBe(0)
    expect(compareVersions('26.11.15', '26.11.16')).toBe(-1)
    expect(compareVersions('26.11.16', '26.11.15')).toBe(1)
    expect(compareVersions('26.10.40', '26.11.1')).toBe(-1)
    expect(compareVersions('25.12.9', '26.1.1')).toBe(-1)
  })

  it('vergleicht den Index numerisch, nicht als Text', () => {
    expect(compareVersions('26.11.9', '26.11.10')).toBe(-1)
    expect(compareVersions('26.9.1', '26.10.1')).toBe(-1)
  })

  it('liefert null, sobald eine Seite unbekannt ist', () => {
    expect(compareVersions('staging-ab12cd3', '26.11.1')).toBeNull()
    expect(compareVersions('26.11.1', '0.0.0')).toBeNull()
    expect(compareVersions(undefined, undefined)).toBeNull()
  })
})

// Vorzeichen: positiv = der Kandidat liegt hinter der Referenz zurueck, negativ = er ist NEUER als die Referenz
// (der Datenverlust-Pfad aus ADR 0070: ein Edge, der neuer ist als die Cloud-Libs).
describe('monthsBehind(referenz, kandidat)', () => {
  it('ist 0 im selben Monat, egal wie weit der Index auseinanderliegt', () => {
    expect(monthsBehind('26.11.15', '26.11.15')).toBe(0)
    expect(monthsBehind('26.11.40', '26.11.1')).toBe(0)
    expect(monthsBehind('26.11.1', '26.11.40')).toBe(0)
  })

  it('zaehlt Monatswechsel', () => {
    expect(monthsBehind('26.11.4', '26.9.30')).toBe(2)
    expect(monthsBehind('26.11.1', '26.10.40')).toBe(1)
    expect(monthsBehind('26.12.1', '26.9.1')).toBe(3)
  })

  it('zaehlt ueber den Jahreswechsel', () => {
    expect(monthsBehind('27.1.1', '26.12.9')).toBe(1)
    expect(monthsBehind('27.2.3', '26.11.20')).toBe(3)
    expect(monthsBehind('27.1.1', '26.1.1')).toBe(12)
  })

  it('wird negativ, wenn der Kandidat neuer ist als die Referenz', () => {
    expect(monthsBehind('26.9.30', '26.11.4')).toBe(-2)
    expect(monthsBehind('26.12.1', '27.1.1')).toBe(-1)
  })

  it('liefert null statt eines Rueckstands, wenn eine Seite keine Version ist', () => {
    expect(monthsBehind('26.11.4', 'staging-ab12cd3')).toBeNull()
    expect(monthsBehind('26.11.4', '0.0.0')).toBeNull()
    expect(monthsBehind('26.11.4', 'smoke')).toBeNull()
    expect(monthsBehind('pr-check', '26.11.4')).toBeNull()
    expect(monthsBehind(undefined, '26.11.4')).toBeNull()
    expect(monthsBehind('26.11.4', undefined)).toBeNull()
  })
})

describe('isVersionDrift(build, server)', () => {
  it('ist false bei gleicher Version, auch mit v-Praefix auf einer Seite', () => {
    expect(isVersionDrift('26.11.16', '26.11.16')).toBe(false)
    expect(isVersionDrift('26.11.16', 'v26.11.16')).toBe(false)
  })

  it('ist ab der ersten Abweichung true, auch innerhalb eines Monats', () => {
    expect(isVersionDrift('26.11.15', '26.11.16')).toBe(true)
    expect(isVersionDrift('26.10.4', '26.11.1')).toBe(true)
    expect(isVersionDrift('26.11.1', '27.1.1')).toBe(true)
  })

  it('meldet auch einen Server, der aelter ist als der Build, als Abweichung', () => {
    expect(isVersionDrift('26.11.16', '26.11.2')).toBe(true)
  })

  it('ist false, sobald eine Seite keine Version ist: nicht vergleichbar, kein Hinweis', () => {
    expect(isVersionDrift('26.11.16', 'staging-ab12cd3')).toBe(false)
    expect(isVersionDrift('staging-ab12cd3', '26.11.16')).toBe(false)
    expect(isVersionDrift('26.11.16', '0.0.0')).toBe(false)
    expect(isVersionDrift('26.11.16', 'smoke')).toBe(false)
    expect(isVersionDrift('26.11.16', '')).toBe(false)
    expect(isVersionDrift('26.11.16', null)).toBe(false)
    expect(isVersionDrift('26.11.16', undefined)).toBe(false)
  })
})
