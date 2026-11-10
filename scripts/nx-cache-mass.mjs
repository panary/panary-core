#!/usr/bin/env node
/**
 * Misst den Nx-Cache der CI so, wie Nx ihn deckelt (#1402).
 *
 * Nx 23 verdrängt bei Überschreitung von `NX_MAX_CACHE_SIZE` nach
 * `SELECT SUM(size) FROM cache_outputs` in der Task-DB — die Summe der
 * Dateigrößen in Bytes, gesammelt beim `put`. `du` zählt dagegen belegte Blöcke;
 * bei tausenden kleinen Ausgabedateien liegt das ein Vielfaches darüber. Die alte
 * Notice („2.2G" bei Deckel 1GB) verglich deshalb zwei verschiedene Maße.
 *
 * Dazu das Alter der Zeilen (#1407): ältester und jüngster Zugriff (`accessed_at`) und älteste
 * Anlage (`created_at`). Nach `accessed_at` verdrängt Nx — erst alles über sieben Tage, dann die
 * ältesten bis unter den Deckel. Das Alter steht in einer eigenen Abfrage: Fehlt eine Spalte nach
 * einem Nx-Update, bleiben die Größenangaben erhalten.
 *
 * Aufruf: node scripts/nx-cache-mass.mjs <cache-verzeichnis> <task-db> [deckel]
 * Gibt eine Zeile aus und endet immer mit 0 — die Messung darf die CI nie rot färben.
 */

import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const EINHEITEN = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }

/** Wie `parseMaxCacheSize` in nx/src/tasks-runner/cache.js: Zahl plus optionale Einheit. */
export function parseDeckel(roh) {
  if (roh === undefined || roh === null || roh === '') return undefined
  const m = String(roh).match(/^(?<zahl>\d+(?:\.\d+)?)\s?(?<einheit>[KMG]?B)?$/)
  if (!m) return undefined
  return parseFloat(m.groups.zahl) * EINHEITEN[m.groups.einheit ?? 'B']
}

export function formatGroesse(bytes) {
  if (bytes >= EINHEITEN.GB) return `${(bytes / EINHEITEN.GB).toFixed(2)} GB`
  if (bytes >= EINHEITEN.MB) return `${(bytes / EINHEITEN.MB).toFixed(0)} MB`
  return `${(bytes / EINHEITEN.KB).toFixed(0)} KB`
}

const STUNDE = 3600 * 1000
const TAG = 24 * STUNDE

/**
 * SQLite `CURRENT_TIMESTAMP` liefert `YYYY-MM-DD HH:MM:SS` in UTC, ohne Zone. `new Date()` läse das
 * als Ortszeit — deshalb von Hand als UTC. Unlesbares ergibt NaN.
 */
export function parseSqliteUtc(roh) {
  const m = String(roh ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?Z?$/)
  if (!m) return NaN
  const [, j, mo, t, h, mi, se, ms = '0'] = m
  return Date.UTC(+j, +mo - 1, +t, +h, +mi, +se, +ms.padEnd(3, '0'))
}

/** Alter in Stunden unter einem Tag, sonst in Tagen; eine Nachkommastelle wie formatGroesse. */
export function formatAlter(ms) {
  const d = Math.max(0, ms)
  return d >= TAG ? `${(d / TAG).toFixed(1)} d` : `${(d / STUNDE).toFixed(1)} h`
}

/**
 * @param roh    { aeltesterZugriff, juengsterZugriff, aeltesteAnlage } aus MIN/MAX der Task-DB
 * @param jetzt  Zeitpunkt der Messung in ms (übergeben, damit die Funktion rein bleibt)
 */
export function alterAuswerten(roh, jetzt) {
  const felder = ['aeltesterZugriff', 'juengsterZugriff', 'aeltesteAnlage']
  if (felder.every(f => roh?.[f] === null || roh?.[f] === undefined)) return { art: 'leer' }
  const werte = {}
  for (const f of felder) {
    const t = parseSqliteUtc(roh[f])
    if (Number.isNaN(t)) return { art: 'fehler', grund: `${f} unlesbar („${roh[f]}")` }
    werte[f] = jetzt - t
  }
  return { art: 'werte', ...werte }
}

export function alterText(alter) {
  if (!alter) return undefined
  if (alter.art === 'leer') return 'Alter: keine Zeilen'
  if (alter.art === 'fehler') return `Alter nicht messbar: ${alter.grund}`
  return [
    `ältester Zugriff vor ${formatAlter(alter.aeltesterZugriff)}`,
    `jüngster vor ${formatAlter(alter.juengsterZugriff)}`,
    `älteste Anlage vor ${formatAlter(alter.aeltesteAnlage)}`,
  ].join(', ')
}

/**
 * @param zeilen  Zeilen aus cache_outputs: { hash, size, is_cache_entry }
 * @param platte  { hashVerzeichnisse: string[], scheinbar: number, belegt: number }
 */
export function auswerten(zeilen, platte, deckel, alter) {
  const eintraege = zeilen.filter(z => Number(z.is_cache_entry) === 1)
  const bekannt = new Set(zeilen.map(z => String(z.hash)))
  const nxMass = zeilen.reduce((s, z) => s + Number(z.size), 0)
  return {
    zeilen: zeilen.length,
    eintraege: eintraege.length,
    nxMass,
    nxMassEintraege: eintraege.reduce((s, z) => s + Number(z.size), 0),
    deckel,
    ueberDeckel: deckel !== undefined && nxMass > deckel,
    verwaist: platte.hashVerzeichnisse.filter(h => !bekannt.has(h)).length,
    hashVerzeichnisse: platte.hashVerzeichnisse.length,
    scheinbar: platte.scheinbar,
    belegt: platte.belegt,
    alter,
  }
}

export function zeile(e) {
  const deckel = e.deckel === undefined ? 'kein Deckel gesetzt' : `Deckel ${formatGroesse(e.deckel)}`
  return [
    `${e.eintraege} Einträge laut DB (${e.zeilen} Zeilen)`,
    `Nx-Maß ${formatGroesse(e.nxMass)} von ${deckel}${e.ueberDeckel ? ' — ÜBER DEM DECKEL' : ''}`,
    `Platte ${formatGroesse(e.scheinbar)} Dateigröße / ${formatGroesse(e.belegt)} belegt`,
    `${e.hashVerzeichnisse} Hash-Verzeichnisse, davon ${e.verwaist} ohne DB-Zeile`,
    alterText(e.alter),
  ]
    .filter(Boolean)
    .join(', ')
}

/** Summiert Dateigröße und belegte Blöcke rekursiv, ohne Symlinks zu folgen. */
function vermessen(pfad, summe) {
  const st = lstatSync(pfad)
  summe.scheinbar += st.isDirectory() ? 0 : st.size
  summe.belegt += st.blocks * 512
  if (st.isDirectory()) for (const n of readdirSync(pfad)) vermessen(join(pfad, n), summe)
  return summe
}

function messen(cacheDir, dbDatei, deckelRoh, jetzt) {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(dbDatei, { readOnly: true })
  let zeilen
  let alter
  try {
    zeilen = db.prepare('SELECT hash, size, is_cache_entry FROM cache_outputs').all()
    try {
      const roh = db
        .prepare(
          'SELECT MIN(accessed_at) AS aeltesterZugriff, MAX(accessed_at) AS juengsterZugriff, ' +
            'MIN(created_at) AS aeltesteAnlage FROM cache_outputs',
        )
        .get()
      alter = alterAuswerten(roh, jetzt)
    } catch (error) {
      alter = { art: 'fehler', grund: String(error.message).split('\n')[0] }
    }
  } finally {
    db.close()
  }
  const hashVerzeichnisse = readdirSync(cacheDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d+$/.test(d.name))
    .map(d => d.name)
  const platte = vermessen(cacheDir, { scheinbar: 0, belegt: 0 })
  return auswerten(zeilen, { hashVerzeichnisse, ...platte }, parseDeckel(deckelRoh), alter)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cacheDir, dbDatei, deckelRoh = process.env.NX_MAX_CACHE_SIZE] = process.argv.slice(2)
  try {
    console.log(zeile(messen(cacheDir, dbDatei, deckelRoh, Date.now())))
  } catch (error) {
    // Eine Zeile: Die Notice zeigt ohnehin nur die erste.
    console.log(`Messung fehlgeschlagen: ${String(error.message).split('\n')[0]}`)
  }
}
