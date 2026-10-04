#!/usr/bin/env node
// Installer-Drift: vergleicht die unter https://get.panary.cloud ausgelieferten Dateien mit
// `tools/hosting/get.panary.cloud/` im Repo und BENACHRICHTIGT bei Abweichung — mehr nicht.
//
// WARUM ES DAS GIBT
// Der Upload in die Bunny-Storage-Zone ist Handarbeit, keine CI laedt hoch. Am 2026-10-03
// lieferte get.panary.cloud noch das install.sh vom 2026-08-04 aus: Jede Neuinstallation bekam
// weder den Watchtower-Fix (#268) noch die Secret-Haertung (#323) — wochenlang unbemerkt
// (#540).
//
// WAS ES BEWUSST NICHT TUT
// Es laedt nichts hoch und laesst nichts rot werden (Entscheidung Michael, 2026-10-04). Ein
// Upload-Weg aus der CI hiesse einen Bunny-Schluessel im Repo — und das Skript laeuft per
// `curl | sudo bash` als root auf jedem neuen Edge. Die Benachrichtigung ist genau EIN offenes
// Issue mit Label `installer-drift`: weitere Laeufe legen kein zweites an, und sobald die
// Dateien wieder uebereinstimmen, schliesst der naechste Lauf es selbst.
//
// UNERREICHBAR IST KEINE ABWEICHUNG
// Antwortet get.panary.cloud nicht, ist nichts gemessen. Dann gibt es nur einen Vermerk in der
// Job-Summary — ein Issue aus einem Netzwerk-Wackler waere ein Fehlalarm, und ein Schliessen
// eine Entwarnung ohne Grundlage.
//
// Verglichen werden Bytes (Git-Blob-Hash, wie `git hash-object`). Eine reine Umformatierung
// im Repo meldet sich also auch — sie IST eine Abweichung von dem, was ausgeliefert wird.
//
// Aufruf:
//   node scripts/installer-drift.mjs            # nur messen und ausgeben
//   node scripts/installer-drift.mjs --anwenden # zusaetzlich Issue oeffnen/schliessen (CI, gh)

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BASIS_URL = 'https://get.panary.cloud'
export const HOSTING_DIR = 'tools/hosting/get.panary.cloud'
export const DATEIEN = ['install.sh', 'index.html']
export const LABEL = 'installer-drift'
const NACHPRUEFUNG_MS = Number(process.env.INSTALLER_DRIFT_NACHPRUEFUNG_MS ?? 30_000)

/** Hash wie `git hash-object`: SHA-1 ueber `blob <laenge>\0<inhalt>`. */
export function blobHash(inhalt) {
  const buf = Buffer.isBuffer(inhalt) ? inhalt : Buffer.from(inhalt)
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

/**
 * Bewertet die Messung je Datei.
 * eintraege: [{ datei, repo: <hash>, live: <hash> | null, fehler?: <text> }]
 *
 * - `abweichung`, sobald EINE erreichbare Datei abweicht — auch wenn eine andere nicht
 *   erreichbar war: die Abweichung ist dann sicher.
 * - `unbekannt`, wenn nichts abweicht, aber mindestens eine Datei nicht gemessen ist.
 * - `gleich` nur, wenn jede Datei gemessen ist und uebereinstimmt.
 */
export function vergleiche(eintraege) {
  const abweichend = eintraege.filter(e => e.live !== null && e.live !== e.repo)
  const unerreichbar = eintraege.filter(e => e.live === null)
  let zustand = 'gleich'
  if (abweichend.length > 0) zustand = 'abweichung'
  else if (unerreichbar.length > 0 || eintraege.length === 0) zustand = 'unbekannt'
  return { zustand, abweichend, unerreichbar }
}

/** Was mit dem Issue geschehen soll. `offen` = Nummern offener `installer-drift`-Issues. */
export function aktion(zustand, offen) {
  if (zustand === 'abweichung') return offen.length === 0 ? 'oeffnen' : 'nichts'
  if (zustand === 'gleich') return offen.length > 0 ? 'schliessen' : 'nichts'
  return 'nichts'
}

function tabelle(eintraege) {
  const zeilen = eintraege.map(e => {
    const live = e.live === null ? `nicht erreichbar (${e.fehler ?? 'unbekannt'})` : `\`${e.live.slice(0, 12)}\``
    const urteil = e.live === null ? '–' : e.live === e.repo ? 'gleich' : '**weicht ab**'
    return `| \`${e.datei}\` | \`${e.repo.slice(0, 12)}\` | ${live} | ${urteil} |`
  })
  return ['| Datei | Repo (`main`) | live | Ergebnis |', '|---|---|---|---|', ...zeilen].join('\n')
}

export function issueBody(eintraege, sha) {
  const { abweichend } = vergleiche(eintraege)
  const dateien = abweichend.map(e => `\`${e.datei}\``).join(', ')
  return `${BASIS_URL} liefert nicht den Stand von \`main\` (\`${sha.slice(0, 8)}\`) aus. Betroffen: ${dateien}.

${tabelle(eintraege)}

**Zu tun (von Hand):** die Dateien aus \`${HOSTING_DIR}/\` in die Bunny-Storage-Zone laden und den
Pull-Zone-Cache leeren. Danach den Workflow „Installer-Drift" per \`workflow_dispatch\` starten — er
schliesst dieses Issue, sobald alles uebereinstimmt. Sonst tut es der naechste taegliche Lauf.

Selbst nachmessen:

\`\`\`bash
curl -fsSL ${BASIS_URL}/install.sh | git hash-object --stdin
git rev-parse origin/main:${HOSTING_DIR}/install.sh
\`\`\`

Dieses Issue ist eine Benachrichtigung, kein Gate: Es blockiert nichts und wird nicht doppelt
angelegt (panary/panary-core#540).`
}

export function summary(eintraege, ergebnis, gewaehlt) {
  const text = {
    gleich: 'Alle ausgelieferten Dateien entsprechen `main`.',
    abweichung: 'Ausgeliefert wird NICHT der Stand von `main`.',
    unbekannt: 'Nicht gemessen — mindestens eine Datei war nicht erreichbar. Kein Issue geoeffnet oder geschlossen.',
  }[ergebnis.zustand]
  return `## Installer-Drift\n\n${text}\n\n${tabelle(eintraege)}\n\nAktion: \`${gewaehlt}\`\n`
}

async function holeLive(datei) {
  try {
    const res = await fetch(`${BASIS_URL}/${datei}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return { live: null, fehler: `HTTP ${res.status}` }
    return { live: blobHash(Buffer.from(await res.arrayBuffer())) }
  } catch (error) {
    return { live: null, fehler: error.name === 'TimeoutError' ? 'Timeout' : error.message }
  }
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim()
}

async function main() {
  const anwenden = process.argv.includes('--anwenden')
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const sha =
    process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

  const eintraege = []
  for (const datei of DATEIEN) {
    const repo = blobHash(readFileSync(join(root, HOSTING_DIR, datei)))
    eintraege.push({ datei, repo, ...(await holeLive(datei)) })
  }
  const ergebnis = vergleiche(eintraege)

  let gewaehlt = 'nichts (ohne --anwenden)'
  if (anwenden) {
    const offeneIssues = () =>
      JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number', '--limit', '20'])).map(
        i => i.number,
      )
    let offen = offeneIssues()
    gewaehlt = aktion(ergebnis.zustand, offen)
    if (gewaehlt === 'oeffnen') {
      // Jede Liste nach Label (Such-Index wie REST) kennt ein gerade angelegtes Issue erst Sekunden
      // spaeter — gemessen bis ~12 s. Ein Lauf direkt nach einem anderen legte so ein zweites an
      // (#554). Deshalb vor dem Anlegen warten und neu fragen; das kostet nur im seltenen Fall
      // einer Abweichung Zeit.
      await new Promise(r => setTimeout(r, NACHPRUEFUNG_MS))
      offen = offeneIssues()
      gewaehlt = aktion(ergebnis.zustand, offen)
    }
    if (gewaehlt === 'oeffnen') {
      gh([
        'label',
        'create',
        LABEL,
        '--color',
        'D93F0B',
        '--force',
        '--description',
        'get.panary.cloud weicht von main ab',
      ])
      const args = ['issue', 'create', '--title', 'get.panary.cloud liefert nicht den Stand von main aus']
      args.push('--label', LABEL, '--body', issueBody(eintraege, sha))
      let url
      try {
        const zuweisung = process.env.INSTALLER_DRIFT_ASSIGNEE
        url = gh(zuweisung ? [...args, '--assignee', zuweisung] : args)
      } catch (error) {
        // Eine gescheiterte Zuweisung (Konto weg, kein Collaborator mehr) darf die Meldung nicht
        // verschlucken — dann eben ohne Zuweisung. Scheitert auch das, ist das Werkzeug kaputt.
        if (!process.env.INSTALLER_DRIFT_ASSIGNEE) throw error
        console.warn(`Zuweisung gescheitert, Issue ohne Zuweisung: ${error.message}`)
        url = gh(args)
      }
      gewaehlt = `oeffnen → ${url}`
    } else if (gewaehlt === 'schliessen') {
      for (const nr of offen) {
        const kommentar = `Stimmt wieder ueberein (\`main\` @ \`${sha.slice(0, 8)}\`):\n\n${tabelle(eintraege)}`
        gh(['issue', 'close', String(nr), '--comment', kommentar])
      }
      gewaehlt = `schliessen → #${offen.join(', #')}`
    }
  }

  const text = summary(eintraege, ergebnis, gewaehlt)
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
