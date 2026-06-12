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
 *
 * Gibt die neue Version auf stdout aus (für Shell-Subshells verwendbar).
 *
 * Verwendung:
 *   node tools/scripts/bump-version.mjs          # Version anheben + ausgeben
 *   VERSION=$(node tools/scripts/bump-version.mjs)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')

const PKG_PATH = resolve(ROOT, 'package.json')
const API_EDGE_PKG_PATH = resolve(ROOT, 'apps/api-edge/package.json')
const TAURI_CONF_PATH = resolve(ROOT, 'apps/pos-client/src-tauri/tauri.conf.json')

// Aktuelles Datum → YY.MM
const now = new Date()
const yy = String(now.getFullYear()).slice(2)  // '26' für 2026
const mm = String(now.getMonth() + 1)          // '4' für April (keine führende Null)
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

// package.json aktualisieren (2-Leerzeichen-Einrückung beibehalten)
pkg.version = newVersion
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n')

// apps/api-edge/package.json aktualisieren — Laufzeit-Quelle für APP_VERSION
// (landet via Nx generatePackageJson in dist/apps/api-edge/package.json)
if (existsSync(API_EDGE_PKG_PATH)) {
  const edgePkg = JSON.parse(readFileSync(API_EDGE_PKG_PATH, 'utf8'))
  edgePkg.version = newVersion
  writeFileSync(API_EDGE_PKG_PATH, JSON.stringify(edgePkg, null, 2) + '\n')
}

// tauri.conf.json aktualisieren (nur wenn Datei existiert)
if (existsSync(TAURI_CONF_PATH)) {
  const tauriConf = JSON.parse(readFileSync(TAURI_CONF_PATH, 'utf8'))
  tauriConf.version = newVersion
  writeFileSync(TAURI_CONF_PATH, JSON.stringify(tauriConf, null, 2) + '\n')
}

// Neue Version auf stdout ausgeben (für Shell-Subshells)
process.stdout.write(newVersion + '\n')
