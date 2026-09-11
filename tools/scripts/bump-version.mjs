#!/usr/bin/env node
/**
 * bump-version.mjs — Automatische Versionsverwaltung
 *
 * Format: YY.MM.INDEX
 *   YY    — 2-stelliges Jahr (z.B. 26 für 2026)
 *   MM    — Monat ohne führende Null (1–12)
 *   INDEX — Inkrementierender Zähler innerhalb des Monats, startet bei 1
 *
 * Aktualisiert automatisch:
 *   - package.json (Projektroot)
 *   - apps/api-edge/package.json (Quelle für APP_VERSION im /health-Endpoint)
 *   - apps/pos-client/src-tauri/tauri.conf.json (nur wenn vorhanden)
 *   - LICENSE (BSL Change Date = heute + 4 Jahre, Copyright-Jahr)
 *   - die publishable Lib-Manifeste (libs/**, `publishable`-Tag) — siehe unten
 *
 * Gibt die neue Version auf stdout aus (für Shell-Subshells verwendbar).
 *
 * Verwendung:
 *   node tools/scripts/bump-version.mjs          # Version anheben + ausgeben
 *   VERSION=$(node tools/scripts/bump-version.mjs)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

import { findPublishableManifests } from './publishable-manifests.mjs'

/**
 * Ersetzt die Top-Level-`version`-Zeile per Textersetzung statt über
 * `JSON.parse` + `JSON.stringify`.
 *
 * Der Round-Trip über JSON.stringify(…, 2) formatiert die **ganze** Datei neu:
 * Alle einzeiligen Arrays werden zu Mehrzeilern. In `tauri.conf.json` sind das
 * `targets`, `icon`, `languages` und `endpoints` — rund 20 Zeilen
 * Formatierungsrauschen in jedem Release-Commit, die den eigentlichen
 * Versionswechsel zudecken und die Gegenprobe „nur Versionszeilen im Commit"
 * unbrauchbar machen.
 *
 * Das Muster verlangt genau zwei Leerzeichen Einrückung — bei
 * 2-Space-Formatierung ist das die Top-Level-Eigenschaft und nichts
 * Verschachteltes. Trifft es nicht, wird geworfen statt still nichts zu tun:
 * Ein Release mit unveränderter Version wäre schlimmer als ein Abbruch.
 */
function writeVersionInPlace(path, version) {
  const raw = readFileSync(path, 'utf8')
  const pattern = /^ {2}"version": "[^"]*"/m
  if (!pattern.test(raw)) {
    throw new Error(`bump-version: keine Top-Level-"version"-Zeile in ${path}`)
  }
  writeFileSync(path, raw.replace(pattern, `  "version": "${version}"`))
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')

const PKG_PATH = resolve(ROOT, 'package.json')
const API_EDGE_PKG_PATH = resolve(ROOT, 'apps/api-edge/package.json')
const TAURI_CONF_PATH = resolve(ROOT, 'apps/pos-client/src-tauri/tauri.conf.json')
const LICENSE_PATH = resolve(ROOT, 'LICENSE')

// Aktuelles Datum → YY.MM
const now = new Date()
const yy = String(now.getFullYear()).slice(2) // '26' für 2026
const mm = String(now.getMonth() + 1) // '4' für April (keine führende Null)
const newPrefix = `${yy}.${mm}`

// Aktuelle Version lesen
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
const current = pkg.version ?? '0.0.0'
const parts = current.split('.')

// INDEX berechnen: wenn gleicher Monat → hochzählen, sonst → 1
let newIndex = 1
if (parts.length === 3 && `${parts[0]}.${parts[1]}` === newPrefix) {
  const parsed = parseInt(parts[2], 10)
  newIndex = Number.isFinite(parsed) ? parsed + 1 : 1
}

const newVersion = `${newPrefix}.${newIndex}`

writeVersionInPlace(PKG_PATH, newVersion)

// apps/api-edge/package.json — Laufzeit-Quelle für APP_VERSION
// (landet via Nx generatePackageJson in dist/apps/api-edge/package.json)
if (existsSync(API_EDGE_PKG_PATH)) {
  writeVersionInPlace(API_EDGE_PKG_PATH, newVersion)
}

if (existsSync(TAURI_CONF_PATH)) {
  writeVersionInPlace(TAURI_CONF_PATH, newVersion)
}

// LICENSE: BSL Change Date auf heute + 4 Jahre, Copyright-Jahr auf das laufende.
//
// Steht hier und nicht (nur) in `release-tag.sh`, weil es zwei Release-Pfade
// gibt: Das Skript für Edge/POS-Releases — und den Ablauf für Lib-Releases
// (`nx release version` + dieses Skript), der `release-tag.sh` bewusst umgeht,
// weil es die publishable Libs nicht bumpt. Lag die LICENSE-Pflege allein im
// Skript, verlor der zweite Pfad sie stillschweigend: Bei v26.8.10 stand das
// Change Date noch auf dem Stand des Vorgänger-Releases.
if (existsSync(LICENSE_PATH)) {
  const pad = n => String(n).padStart(2, '0')
  const changeDate = `${now.getFullYear() + 4}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const license = readFileSync(LICENSE_PATH, 'utf8')
    .replace(/^Change Date:.*$/m, `Change Date:          ${changeDate} (Four years from the release date)`)
    .replace(/\(c\) (\d{4})-\d{4}/, `(c) $1-${now.getFullYear()}`)
  writeFileSync(LICENSE_PATH, license)
}

// Die publishable Lib-Manifeste mitziehen.
//
// Bis #242 tat das ausschliesslich `nx release version` — ein zweiter,
// eigenstaendig auszuloesender Release-Pfad (ADR 0002). Wurde er vergessen, lief
// `publish-libraries.yml` trotzdem, versuchte die bereits veroeffentlichte
// Vorversion erneut hochzuladen und meldete dabei SUCCESS. Vier der
// v26.8.*-Releases sind so durchgelaufen und mussten nachtraeglich geheilt
// werden; in den Fenstern dazwischen liefen Edge und Cloud auf verschiedenen
// Schema-Staenden (bei 26.8.21 das `discounts`-Feld im geteilten receiptSchema
// mit `additionalProperties: false` — die Cloud wies rabattierte Belege bei der
// Validierung ab, Sync TERMINAL, kein Retry).
//
// Hier statt in `release-tag.sh`, weil dieses Skript auch allein aufgerufen wird
// (`pnpm version:bump`, Lib-Release-Ablauf) — laege der Bump in der Shell,
// bestuende der Defekt fuer jeden Direktaufruf fort. Dupliziert wird dabei kaum
// etwas: `nx release version` aendert an jedem Manifest genau die version-Zeile,
// die peerDependencies-Ranges bleiben unberuehrt.
const publishable = findPublishableManifests(ROOT)
if (publishable.length === 0) {
  throw new Error(
    'bump-version: kein publishable Lib-Manifest gefunden. Ein Release ohne Lib-Bump laesst ' +
      'publish-libraries.yml gruen durchlaufen, ohne etwas zu publizieren — deshalb Abbruch statt Weitermachen.',
  )
}
for (const { manifestPath } of publishable) {
  writeVersionInPlace(manifestPath, newVersion)
}
// Auf stderr, weil stdout die Version traegt: `release-tag.sh` liest sie als
// `VERSION=$(node .../bump-version.mjs)`.
process.stderr.write(`bump-version: ${publishable.length} publishable Lib-Manifest(e) auf ${newVersion} gesetzt\n`)

// Neue Version auf stdout ausgeben (für Shell-Subshells)
process.stdout.write(newVersion + '\n')
