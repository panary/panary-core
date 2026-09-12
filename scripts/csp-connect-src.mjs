#!/usr/bin/env node
// CSP-Gate: prueft die `connect-src`-Direktive des gepackten POS gegen die
// Ziele, die der Webview tatsaechlich anspricht — und gegen die, die er seit
// ADR 0036 NICHT mehr ansprechen darf.
//
// WARUM ES DIESES GATE GIBT
// Die CSP wirkt ausschliesslich im gepackten Build zur Laufzeit. Tauri setzt den
// Header nur im `tauri://`-Asset-Handler; unter `#[cfg(dev)]` navigiert der
// Webview direkt auf die `devUrl` und es gibt gar keine CSP. `pnpm tauri:dev`
// und der Browser beweisen fuer sie also nichts, und kein Test und kein anderes
// Gate fasst sie an. Genau in dieser Luecke stand der MQTT-Druck: `connect-src`
// kannte an WebSockets nur Port 3030, der Broker lauscht auf 9001 — seit
// `pos-v26.4.10` unbemerkt, weil lokal jeder Druck ging (#296).
//
// ZWEI RICHTUNGEN, BEIDE NOETIG
// 1. Zu eng: ein Ziel, das der Webview braucht, ist nicht gedeckt. Das war #296.
// 2. Zu weit: jemand loest so einen Fall wieder mit einer Schema-Quelle (`ws:`,
//    `https:`) oder `*`. Das ist keine Direktive mehr, sondern deren Abschaltung
//    — und faellt niemandem auf, weil alles funktioniert. Der Sofortfix in #296
//    war genau das, bewusst und befristet bis zu diesem ADR.
//
// WAS ES NICHT MISST
// Ob die Liste ERWARTETER Ziele unten noch vollstaendig ist. Ein neuer Aufruf an
// einen neuen Host faellt hier nicht auf, sondern erst im gepackten Build. Das
// Gate haelt fest, was wir wissen; es entdeckt nichts von selbst. Ein Versuch,
// die Ziele aus dem Quelltext zu ziehen, scheiterte an der Realitaet der
// Aufrufe: Basis-URLs kommen aus Geraete-Konfiguration und Settings, im Code
// steht nur `${base}/print-server/print-order`.
//
// Der Matcher ist bewusst KONSERVATIV: Was er nicht sicher als gedeckt erkennt,
// meldet er als nicht gedeckt. Ein Irrtum erzeugt damit einen Fehlalarm auf
// einem erwartet-erlaubten Ziel — nie ein falsches Gruen auf einem erwartet
// verbotenen.
//
// Aufruf:
//   pnpm csp:gate

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CONFIG_PATH = 'apps/pos-client/src-tauri/tauri.conf.json'

/** Schema-Quellen und Wildcards, die die Direktive praktisch abschalten. */
export const BLANKET_SOURCES = new Set(['*', 'http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:'])

/**
 * Ziele, die der Webview des gepackten POS anspricht (oder seit ADR 0036 eben
 * nicht mehr). Hosts sind Beispiele — geprueft wird Schema, Host-Muster, Port.
 */
export const EXPECTED = [
  { url: 'http://10.0.0.5:3030/print-server/print-order', allowed: true, why: 'Bon-Druck auf IP-Drucker am Edge' },
  { url: 'ws://10.0.0.5:3030/ws', allowed: true, why: 'Feathers-Socket zum Edge' },
  { url: 'wss://10.0.0.5:3030/ws', allowed: true, why: 'Feathers-Socket zum Edge (TLS)' },
  { url: 'https://api.panary.cloud/authentication', allowed: true, why: 'Cloud-Pairing' },
  { url: 'wss://api.panary.cloud/ws', allowed: true, why: 'Cloud-Socket' },
  {
    url: 'https://github.com/panary/panary-core/releases/latest/download/latest.json',
    allowed: true,
    why: 'Updater-Manifest',
  },
  { url: 'ws://10.0.0.5:9001/mqtt', allowed: false, why: 'MQTT laeuft im Rust-Prozess (ADR 0036)' },
  { url: 'wss://broker.example:8084/mqtt', allowed: false, why: 'MQTT laeuft im Rust-Prozess (ADR 0036)' },
]

const DEFAULT_PORTS = { 'http:': 80, 'https:': 443, 'ws:': 80, 'wss:': 443 }

/** Liest die `connect-src`-Quellen aus der CSP der Tauri-Konfiguration. */
export function readConnectSrc(configPath = join(ROOT, CONFIG_PATH)) {
  const csp = JSON.parse(readFileSync(configPath, 'utf8'))?.app?.security?.csp
  if (typeof csp !== 'string') throw new Error(`Keine CSP in ${configPath}`)
  const directive = csp
    .split(';')
    .map(d => d.trim())
    .find(d => d === 'connect-src' || d.startsWith('connect-src '))
  if (!directive) throw new Error(`Keine connect-src-Direktive in ${configPath}`)
  return directive.split(/\s+/).slice(1)
}

/**
 * Matcht eine URL gegen eine einzelne CSP-Quelle (Teilmenge von CSP3
 * §6.7.2 host-source, ohne Pfad-Teil — der spielt in `connect-src` hier
 * keine Rolle).
 *
 * Umgesetzt ist auch die Schema-Aufweichung der Spezifikation: Eine
 * `http`-Quelle deckt `https`, `ws` und `wss` mit ab, eine `https`-Quelle deckt
 * `wss`. Ohne sie meldete das Gate `ws://…:3030` als ungedeckt, obwohl der
 * Browser es zulaesst.
 */
export function sourceMatches(source, url) {
  if (BLANKET_SOURCES.has(source)) return true
  if (!source.includes('://')) return false // 'self', ipc-Schemata, Nonces …

  const [scheme, rest] = [source.slice(0, source.indexOf('://') + 1), source.slice(source.indexOf('://') + 3)]
  const target = new URL(url)

  const schemeOk =
    scheme === target.protocol ||
    (scheme === 'http:' && ['https:', 'ws:', 'wss:'].includes(target.protocol)) ||
    (scheme === 'https:' && target.protocol === 'wss:')
  if (!schemeOk) return false

  const colon = rest.lastIndexOf(':')
  const hostPattern = colon > 0 ? rest.slice(0, colon) : rest
  const portPattern = colon > 0 ? rest.slice(colon + 1) : null

  const hostOk =
    hostPattern === '*' ||
    hostPattern === target.hostname ||
    (hostPattern.startsWith('*.') && target.hostname.endsWith(hostPattern.slice(1)))
  if (!hostOk) return false

  const targetPort = target.port ? Number(target.port) : DEFAULT_PORTS[target.protocol]
  if (portPattern === null) return targetPort === DEFAULT_PORTS[target.protocol]
  if (portPattern === '*') return true
  return Number(portPattern) === targetPort
}

/** Ist `url` von mindestens einer der Quellen gedeckt? */
export function isAllowed(sources, url) {
  return sources.some(source => sourceMatches(source, url))
}

/** Alle Befunde — leer heisst gruen. */
export function check(sources, expected = EXPECTED) {
  const problems = []

  for (const source of sources) {
    if (BLANKET_SOURCES.has(source)) {
      problems.push(
        `Pauschal-Quelle \`${source}\` in connect-src — das schaltet die Direktive fuer dieses Schema ab. ` +
          `Konkrete Ziele eintragen; ein Ziel aus Betreiber-Konfiguration gehoert nicht in den Webview (ADR 0036).`,
      )
    }
  }

  for (const { url, allowed, why } of expected) {
    const actual = isAllowed(sources, url)
    if (actual === allowed) continue
    problems.push(
      allowed
        ? `NICHT gedeckt, wird aber gebraucht: ${url} (${why})`
        : `Gedeckt, darf es aber nicht sein: ${url} (${why})`,
    )
  }

  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sources = readConnectSrc()
  const problems = check(sources)
  if (problems.length === 0) {
    console.log(
      `connect-src (${CONFIG_PATH}): ${sources.length} Quellen, ${EXPECTED.length} Ziele geprueft — in Ordnung.`,
    )
    process.exit(0)
  }
  console.error(`connect-src (${CONFIG_PATH}) — ${problems.length} Befund(e):\n`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nHintergrund: scripts/csp-connect-src.mjs, docs/adr/0036-mqtt-publish-im-rust-prozess.md')
  process.exit(1)
}
