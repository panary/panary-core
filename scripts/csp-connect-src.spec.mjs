#!/usr/bin/env node
/**
 * Tests fuer csp-connect-src.mjs.
 *
 * Reines Node-Skript, kein Vitest-Spec — gleiche Begruendung wie bei den
 * uebrigen Gate-Specs: kein Vitest-Projekt schliesst `scripts/` ein. Der Aufruf
 * steht deshalb explizit in der CI, und zwar VOR dem Gate selbst.
 *
 * Geprueft wird vor allem der Matcher. Ein Gate, dessen Matcher zu grosszuegig
 * ist, meldet den verbotenen Broker-Port als „nicht gedeckt" und bleibt gruen,
 * waehrend die Direktive ihn laengst wieder erlaubt — also genau der stille
 * Fehlschlag, gegen den es gebaut wurde. Deshalb steht hier neben dem
 * Positiv-Fall jedes Mal der knapp danebenliegende Negativ-Fall.
 */

import assert from 'node:assert/strict'

import { BLANKET_SOURCES, check, isAllowed, readConnectSrc, sourceMatches } from './csp-connect-src.mjs'

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

/** Der reale Stand nach ADR 0036, gekuerzt auf das Wesentliche. */
const SOURCES = [
  "'self'",
  'ipc://localhost',
  'http://ipc.localhost',
  'http://*:3030',
  'ws://*:3030',
  'wss://*:3030',
  'https://*.panary.cloud',
  'wss://*.panary.cloud',
  'https://github.com',
]

test('Port-Muster trennt den Edge-Port vom Broker-Port', () => {
  assert.equal(sourceMatches('ws://*:3030', 'ws://10.0.0.5:3030/ws'), true)
  // Der Fall, an dem #296 haengenblieb: gleicher Host, anderer Port.
  assert.equal(sourceMatches('ws://*:3030', 'ws://10.0.0.5:9001/mqtt'), false)
})

test('Subdomain-Wildcard matcht nur echte Subdomains', () => {
  assert.equal(sourceMatches('wss://*.panary.cloud', 'wss://api.panary.cloud/ws'), true)
  assert.equal(sourceMatches('wss://*.panary.cloud', 'wss://panary.cloud.angreifer.example/ws'), false)
})

test('Schema-Aufweichung nach CSP3: http deckt ws/wss, https deckt wss', () => {
  assert.equal(sourceMatches('http://*:3030', 'ws://10.0.0.5:3030/ws'), true)
  assert.equal(sourceMatches('https://github.com', 'wss://github.com/x'), true)
  // Umgekehrt gilt es NICHT — eine wss-Quelle deckt kein Klartext-ws.
  assert.equal(sourceMatches('wss://*:3030', 'ws://10.0.0.5:3030/ws'), false)
})

test('Quelle ohne Port meint den Standardport des Schemas', () => {
  assert.equal(sourceMatches('https://github.com', 'https://github.com/panary/x'), true)
  assert.equal(sourceMatches('https://github.com', 'https://github.com:8443/panary/x'), false)
})

test("Quellen ohne '://' ('self', Nonces) matchen nie ein externes Ziel", () => {
  assert.equal(sourceMatches("'self'", 'ws://10.0.0.5:9001/mqtt'), false)
  assert.equal(sourceMatches("'unsafe-inline'", 'https://github.com/x'), false)
})

test('jede Pauschal-Quelle matcht alles — das ist der Sinn der Sperrliste', () => {
  for (const blanket of BLANKET_SOURCES) {
    assert.equal(sourceMatches(blanket, 'ws://10.0.0.5:9001/mqtt'), true, `${blanket} sollte alles matchen`)
  }
})

test('check() ist gruen auf dem Stand nach ADR 0036', () => {
  assert.deepEqual(check(SOURCES), [])
})

test('check() schlaegt an, wenn der Broker-Port wieder gedeckt wird', () => {
  const problems = check([...SOURCES, 'ws://*:9001'])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /Gedeckt, darf es aber nicht sein.*9001/)
})

test('check() schlaegt an, wenn eine Pauschal-Quelle zurueckkehrt', () => {
  // Der Sofortfix aus #296. Er deckt zugleich beide MQTT-Ziele wieder ab,
  // also drei Befunde: die Quelle selbst plus zwei verbotene Ziele.
  const problems = check([...SOURCES, 'ws:', 'wss:'])
  assert.equal(problems.filter(p => p.startsWith('Pauschal-Quelle')).length, 2)
  assert.equal(problems.filter(p => p.startsWith('Gedeckt, darf es aber nicht sein')).length, 2)
})

test('check() schlaegt an, wenn ein gebrauchtes Ziel herausfaellt', () => {
  const problems = check(SOURCES.filter(s => s !== 'http://*:3030' && s !== 'ws://*:3030' && s !== 'wss://*:3030'))
  assert.ok(problems.some(p => p.startsWith('NICHT gedeckt') && p.includes('print-server')))
})

test('readConnectSrc liest die echte Konfiguration und findet den Edge-Port', () => {
  const sources = readConnectSrc()
  assert.ok(sources.length > 0)
  assert.equal(isAllowed(sources, 'http://10.0.0.5:3030/print-server/print-order'), true)
  assert.equal(isAllowed(sources, 'ws://10.0.0.5:9001/mqtt'), false)
})

if (failures > 0) {
  console.error(`\n${failures} Test(s) fehlgeschlagen.`)
  process.exit(1)
}
console.log('\ncsp-connect-src.spec.mjs: alle Tests bestanden.')
