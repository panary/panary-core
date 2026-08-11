#!/usr/bin/env node
/**
 * Tests fuer docs-adr-index.mjs.
 *
 * Bewusst ein reines Node-Skript und kein Vitest-Spec — gleiche Begruendung wie bei
 * `docs-log.spec.mjs` und `typecheck-gate.spec.mjs`: `vitest.workspace.ts` globt nur
 * `**\/vite.config.*` und `**\/vitest.config.*`, kein Projekt schliesst `scripts/` ein.
 * Der Aufruf steht deshalb explizit in der CI.
 *
 * Zwei Dinge tragen hier die Last. Erstens der Frontmatter-Leser: Er ersetzt eine von
 * Hand gepflegte Liste, also muss er sie exakt reproduzieren. Der Round-Trip gegen den
 * Bestand deckte prompt zwei Drift-Faelle auf — ADR 0019 stand mit gekuerztem Titel im
 * Index, ADR 0020 mit einer aelteren Fassung der description. 22 von 24 Zeilen stimmten,
 * verglichen hatte die beiden Quellen nie jemand. Genau die Drift schafft ein Generat ab.
 * Zweitens der Drift-Schutz `checkIndexFile`: Ohne ihn waechst die Liste in index.md still
 * nach, und der Konflikt aus #161 ist zurueck, ohne dass es jemandem auffaellt.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkIndexFile, nextNumber, parseFrontmatter, parseName, readAdrs, render } from './docs-adr-index.mjs'

let failures = 0
const test = (name, fn) => {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures++
    console.error(`  FAIL ${name}\n       ${error.message}`)
  }
}

const frontmatter = (fields = {}) =>
  [
    '---',
    `type: ${fields.type ?? 'ADR'}`,
    `title: ${fields.title ?? 'Ein Titel'}`,
    `description: ${fields.description ?? 'Ein Satz.'}`,
    'tags: [ci]',
    'status: stable',
    'decision: accepted',
    'generated: { by: test, at: 2026-08-11T00:00:00.000Z }',
    '---',
    '',
    '# Body',
    '',
  ].join('\n')

console.log('parseName')

test('nimmt NNNN-<kebab-slug>.md', () => {
  assert.deepEqual(parseName('0025-adr-index-generiert.md'), {
    nr: 25,
    padded: '0025',
    slug: 'adr-index-generiert',
  })
})

test('weist ab, was nicht passt', () => {
  for (const bad of ['index.md', 'log.md', '25-zu-kurz.md', '0025.md', '0025-Gross.md', '0025-.md']) {
    assert.equal(parseName(bad), null, bad)
  }
})

console.log('parseFrontmatter')

test('liest die drei Skalare', () => {
  const fields = parseFrontmatter(frontmatter())
  assert.equal(fields.type, 'ADR')
  assert.equal(fields.title, 'Ein Titel')
  assert.equal(fields.description, 'Ein Satz.')
})

test('nimmt einfach quotierte Werte mit Doppelpunkt im Inhalt', () => {
  // Fuenf ADRs im Bestand quotieren ihre description, und 0007 hat den Doppelpunkt
  // im Inhalt ('… nach §146a AO: immutable Receipts-Domain, …'), 0010 sogar im Titel.
  // Ein naiver Split am ersten ':' liefert dort einen abgeschnittenen Wert.
  const fields = parseFrontmatter("---\ntype: ADR\ndescription: 'Festlegung: a, b; c.'\n---\n")
  assert.equal(fields.description, 'Festlegung: a, b; c.')
})

test('entquotet doppelt quotierte Werte und escapte Quotes', () => {
  assert.equal(parseFrontmatter('---\ntitle: "Der \\"Fall\\""\n---\n').title, 'Der "Fall"')
  assert.equal(parseFrontmatter("---\ntitle: 'Michaels ''Fall'''\n---\n").title, "Michaels 'Fall'")
})

test('ignoriert eingerueckte Blockzeilen statt sie halb zu verstehen', () => {
  // Vorbeugend: Kein core-ADR nutzt heute den `sources:`-Block, das Frontmatter-Profil
  // erlaubt ihn aber ausdruecklich (documentation.md §2), und in panary-cloud steht er
  // bereits in zwei ADRs. Seine Unterzeilen duerfen weder als eigene Felder durchgehen
  // noch an den vorherigen Wert angehaengt werden.
  const fields = parseFrontmatter(
    ['---', 'title: T', 'sources:', '  - id: x', '    resource: ./0040-y.md', 'status: stable', '---'].join('\n'),
  )
  assert.equal(fields.title, 'T')
  assert.equal(fields.status, 'stable')
  assert.equal(fields.id, undefined)
})

test('meldet fehlenden oder unabgeschlossenen Block als null', () => {
  assert.equal(parseFrontmatter('# Kein Frontmatter\n'), null)
  assert.equal(parseFrontmatter('---\ntitle: T\n'), null)
})

console.log('readAdrs / render')

const dir = mkdtempSync(join(tmpdir(), 'docs-adr-'))
mkdirSync(join(dir, 'adr'))
const adrDir = join(dir, 'adr')
writeFileSync(join(adrDir, '0002-zweiter.md'), frontmatter({ title: 'Zweiter', description: 'Zwei.' }))
writeFileSync(join(adrDir, '0001-erster.md'), frontmatter({ title: 'Erster', description: 'Eins.' }))
writeFileSync(join(adrDir, 'index.md'), '# ADRs\n\nKein Listeneintrag hier.\n')

test('liest alle ADRs und ueberspringt index.md', () => {
  const { adrs, problems } = readAdrs(adrDir)
  assert.equal(adrs.length, 2)
  assert.deepEqual(problems, [])
})

test('rendert nach Nummer sortiert im Bestandsformat', () => {
  assert.equal(
    render(readAdrs(adrDir).adrs),
    [
      '# ADRs — Architektur-Entscheidungen',
      '',
      '* [Erster](0001-erster.md) - Eins.',
      '* [Zweiter](0002-zweiter.md) - Zwei.',
      '',
    ].join('\n'),
  )
})

test('meldet Doppelnummern — der 0046-Dreifachtreffer vom 2026-08-10', () => {
  const doppelt = mkdtempSync(join(tmpdir(), 'docs-adr-dup-'))
  writeFileSync(join(doppelt, '0046-betriebsart.md'), frontmatter())
  writeFileSync(join(doppelt, '0046-order-gate.md'), frontmatter())
  const { problems } = readAdrs(doppelt)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /Nummer 0046 doppelt/)
  assert.match(problems[0], /0046-betriebsart\.md, 0046-order-gate\.md/)
})

test('meldet kaputte Namen und fehlende Pflichtfelder, ohne abzubrechen', () => {
  writeFileSync(join(adrDir, 'kaputt.md'), frontmatter())
  writeFileSync(join(adrDir, '0003-ohne-description.md'), '---\ntype: ADR\ntitle: T\n---\n')
  writeFileSync(join(adrDir, '0004-falscher-typ.md'), frontmatter({ type: 'Architecture' }))
  const { adrs, problems } = readAdrs(adrDir)
  assert.equal(adrs.length, 4, 'die intakten ADRs kommen weiterhin durch')
  const joined = problems.join('\n')
  assert.match(joined, /kaputt\.md: Dateiname/)
  assert.match(joined, /0003-ohne-description\.md: description fehlt/)
  assert.match(joined, /0004-falscher-typ\.md: type ist "Architecture"/)
})

test('fehlendes Verzeichnis ist ein Problem, kein Absturz', () => {
  const { adrs, problems } = readAdrs(join(dir, 'gibt-es-nicht'))
  assert.deepEqual(adrs, [])
  assert.equal(problems.length, 1)
})

console.log('checkIndexFile')

test('laesst eine index.md ohne Liste durch', () => {
  assert.deepEqual(checkIndexFile(adrDir), [])
})

test('laesst einen ADR-Link im Fliesstext durch', () => {
  // Die index.md verlinkt ihre eigene Begruendung — das darf der Schutz nicht treffen.
  const prosa = mkdtempSync(join(tmpdir(), 'docs-adr-prosa-'))
  writeFileSync(join(prosa, 'index.md'), '# ADRs\n\nBegruendung: [ADR 0025](0025-adr-index-generiert.md).\n')
  assert.deepEqual(checkIndexFile(prosa), [])
})

test('schlaegt an, wenn die Liste wieder in index.md waechst', () => {
  const rueckfall = mkdtempSync(join(tmpdir(), 'docs-adr-rueckfall-'))
  writeFileSync(
    join(rueckfall, 'index.md'),
    '# ADRs\n\n* [Erster](0001-erster.md) - Eins.\n- [Zweiter](0002-zweiter.md) - Zwei.\n',
  )
  const problems = checkIndexFile(rueckfall)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /2 Listenzeile/)
})

test('meldet eine fehlende index.md', () => {
  assert.match(checkIndexFile(join(dir, 'gibt-es-nicht'))[0], /fehlt/)
})

console.log('nextNumber')

test('gibt hoechste + 1', () => {
  assert.equal(nextNumber(new Set([1, 2, 24])), 25)
})

test('fuellt Luecken NICHT auf', () => {
  // Eine Luecke heisst: Diese Nummer hat schon jemand benutzt und wieder aufgegeben.
  // Sie steht dann womoeglich in einem Issue-Kommentar — nie erneut vergeben.
  assert.equal(nextNumber(new Set([1, 2, 5])), 6)
})

test('startet bei leerer Menge mit 1', () => {
  assert.equal(nextNumber(new Set()), 1)
})

console.log(failures ? `\n${failures} Test(s) fehlgeschlagen.` : '\nAlle Tests gruen.')
process.exit(failures ? 1 : 0)
