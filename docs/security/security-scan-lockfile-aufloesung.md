---
type: Report
title: Der lokale Security-Scan maß den Workbench-Baum — Lockfile-Auflösung über einen Symlink
description: Im Haupt-Checkout ist panary-core/pnpm-lock.yaml ein Symlink aufs Workbench-Root-Lockfile; existsSync folgte ihm, und der Scan maß den Abhängigkeitsbaum des Workbench statt den von panary-core — drei Befunde gegen null im Worktree desselben Commits, darunter ein HIGH, das nie im Edge-Image steckte.
tags: [security, supply-chain, tooling, gates]
status: stable
generated: { by: claude-code/opus-5, at: 2026-09-20T19:07:21.000Z }
---

# Der lokale Security-Scan maß den Workbench-Baum — Lockfile-Auflösung über einen Symlink

## Der Befund

`scripts/security-scan.mjs` suchte sein Lockfile so:

```js
const candidates = [resolve(repoRoot, 'pnpm-lock.yaml'), resolve(repoRoot, '..', 'pnpm-lock.yaml')]
const lockfile = candidates.find(p => existsSync(p))
```

Im Haupt-Checkout `_WORKBENCH_PANARY/panary-core/` ist `pnpm-lock.yaml` ein **Symlink**
auf `../pnpm-lock.yaml`, das Lockfile des Workbench-Roots. Der Symlink ist Absicht und
bleibt — er steht mit `skip-worktree` im Index, siehe
`.claude/rules/workflow-plan-issue-worktree.md` §3. `existsSync` folgt Symlinks, der
erste Kandidat traf also **immer**, und gemessen wurde der Abhängigkeitsbaum des
Workbench — nie der von panary-core.

Gemessen am 2026-09-20 mit osv-scanner 2.3.8, jeweils auf `origin/main` @ `5d8a6d88`:

| Lauf | Lockfile | `--config` | Befunde |
| --- | --- | --- | --- |
| Haupt-Checkout (altes Skript) | Workbench-Root | ja | **3** — adm-zip 7.5 (high), adm-zip 6.8, postcss-selector-parser 4.3 |
| Worktree (altes Skript) | core, committet | ja | **0** |
| Haupt-Checkout (neues Skript) | core, committet | ja | **0** |
| beliebig, ohne `--config` | core, committet | **nein** | 2 × image-size, CVSS 8.7 |

Derselbe Commit, dieselbe Schwelle, zwei verschiedene Antworten — abhängig allein
davon, aus welchem Verzeichnis der Scan lief.

## Warum die Versionen auseinanderlaufen

Nicht durch Zufall, sondern durch `pnpm.overrides`. Die Override-Liste in
`panary-core/package.json` setzt Mindestversionen, die der Workbench-Root nicht kennt —
seine eigene Liste ist leer:

| Paket | core (committet) | Workbench-Root | Advisory |
| --- | --- | --- | --- |
| adm-zip | 0.6.1 (Override `^0.6.1`) | 0.6.0 | GHSA-7q85-xj36-vmfc, **high** |
| postcss-selector-parser | 7.1.6 | 7.1.1 | GHSA-w9m9-85wc-3x92 |

Der HIGH-Befund, der beim Release **v26.9.7** auftauchte, stammte aus
`@module-federation/dts-plugin` im Workbench-Root und steckt **nicht** im ausgelieferten
Edge-Image. Das ist die harmlosere Hälfte: falscher Alarm kostet Zeit.

**Die teure Hälfte ist die Gegenrichtung.** Ein Advisory, das nur in cores eigenem
Lockfile steht, blieb lokal unsichtbar. „Lokal grün" bewies im Haupt-Checkout nichts
über panary-core — und genau als Nachweis wird der Scan in Issue-Checklisten geführt.
Daher auch der wiederkehrende Widerspruch zwischen lokalem Lauf und dem CI-Check
`osv-scanner (SCA)`, der immer das committete Lockfile sieht.

## Die Korrektur

Ein Kandidat wird verworfen, wenn er ein Symlink ist, dessen Ziel außerhalb von
`repoRoot` liegt (`lstatSync().isSymbolicLink()` plus `realpathSync`). Gemessen wird
dann, was der Repo-Stand tatsächlich meint: `git show HEAD:pnpm-lock.yaml`, geschrieben
in ein Temp-Verzeichnis.

Zwei Details sind nicht verhandelbar:

- **Die Temp-Datei muss `pnpm-lock.yaml` heißen** — osv-scanner v2 bestimmt seinen
  Extractor am Dateinamen. Ein anderer Name reproduziert exakt den Fehler
  „could not determine extractor suitable to this file", der schon
  [den v1-Aufruf](lokaler-security-scan-blind.md) zu Fall brachte. Deshalb ein
  Temp-**Verzeichnis**, keine Temp-Datei.
- **Der Rückfall aufs Elternverzeichnis ist ersatzlos weg.** Findet sich weder ein
  repo-eigenes Lockfile noch ein committeter Stand, meldet der Scan `failScan` und
  endet auf Exit 2. Der Nachbarbaum ist keine Antwort auf die Frage, wovon dieses Repo
  abhängt — und „kein Ergebnis" ist besser als „falsch gemessen".

## Die Falle beim Umzug nach /tmp

`osv-scanner.toml` liegt neben dem repo-lokalen Lockfile, und osv-scanner sucht seine
Konfiguration **nur im Verzeichnis des gescannten Manifests**. Ein Lockfile in `/tmp`
verliert damit still jede `IgnoredVuln`.

Gemessen: ohne `--config` kehren zwei bewusst akzeptierte image-size-Advisories zurück
(`GHSA-5p2g-fcmc-qvqq`, `GHSA-w3rx-r6r6-pgpr`, je CVSS 8.7) — Befunde, für die es keinen
Fix gibt und deren Einordnung im Kopf von `osv-scanner.toml` steht. Der Aufruf gibt
`--config <repoRoot>/osv-scanner.toml` deshalb **explizit** mit.

Das ist die eigentliche Kante dieser Änderung: Die Korrektur verschiebt das Manifest,
und ein verschobenes Manifest nimmt seine Konfiguration nicht mit. Wer den Temp-Umweg
später anfasst, muss das Flag mitdenken.

## Der Nachweis: die Mutationsprobe

Ein grüner Lauf beweist hier nichts — beide Fassungen laufen grün, sie messen nur
Verschiedenes. Der Nachweis ist deshalb der Vergleich **derselben Lage** mit beiden
Fassungen. Die Symlink-Lage des Haupt-Checkouts wurde dafür in einem Worktree exakt
nachgebaut: echtes core-Repo, `pnpm-lock.yaml` als lebender Symlink auf dasselbe
Workbench-Root-Lockfile (einziger Unterschied zum Haupt-Checkout ist `skip-worktree`,
für `lstat` ohne Belang).

| Lage | Fassung | Befunde | stderr unter `--quiet` |
| --- | --- | --- | --- |
| echte Datei | neu | 0 | `./pnpm-lock.yaml — Arbeitsbaum` |
| Symlink nach außen | alt | 3 | *(leer)* |
| Symlink nach außen | neu | 0 | `./pnpm-lock.yaml — committeter Stand HEAD@5d8a6d88, …` |

⚠️ **Ein toter Symlink hätte die Probe wertlos gemacht.** Der erste Nachbau zeigte auf
ein nicht existierendes Ziel; `existsSync` liefert dann `false`, der Rückfall greift,
und das Ergebnis sieht aus wie ein Erfolg — geprüft wäre der eigentliche Fall (lebender
Symlink auf einen *anderen* Baum) aber nie worden. Der Nachbau muss das Ziel treffen,
sonst misst er das Gegenteil.

## Warum die Lockfile-Zeile unter `--quiet` sichtbar ist

Die Zeile `► osv-scanner (lockfile: …)` gab es vorher schon — sie lief durch `log()`
und war damit im pre-push-Hook unsichtbar, denn der ruft
`pnpm security:scan --mode=local --quiet --max-severity=critical`. Genau dort wäre sie
gebraucht worden: Sie ist die einzige Stelle, an der ein Lauf sagt, worüber er
eigentlich urteilt.

Sie schreibt jetzt direkt nach stderr, aus demselben Grund, aus dem `failScan` und die
`--max-severity`-Meldung `log()` bereits umgehen, und nennt zusätzlich die Herkunft
(`Arbeitsbaum` oder `committeter Stand HEAD@<sha>`). Ein Scan, der nicht sagt, was er
gemessen hat, meldet grün, ohne hingesehen zu haben.

## Was das nicht löst

- **Eine uncommittete Lockfile-Änderung bleibt im Haupt-Checkout unsichtbar.** Gemessen
  wird dort der committete Stand. Im Worktree — wo laut Konvention gearbeitet wird —
  zählt weiterhin der Arbeitsbaum.
- **Das Workbench-Root-Lockfile wird von niemandem mehr gescannt.** Seine Befunde
  (adm-zip, postcss-selector-parser) sind damit nicht verschwunden, sondern nur nicht
  mehr fälschlich core zugerechnet. Ob sie eigenständig verfolgt werden, ist offen.
- **Die Cargo-Seite ist ungeprüft.** `apps/pos-client/src-tauri/osv-scanner.toml` hat
  eine eigene Manifest-Auflösung; ob dort dieselbe Verwechslung steckt, wurde nicht
  gemessen.
- **Kein Test deckt das Skript ab.** Die Mutationsprobe ist ein Handgriff, kein Gate —
  eine grüne CI beweist über diesen Pfad weiterhin nichts.
- **Gemessen wurde nur macOS mit osv-scanner 2.3.8.**
- ~~**panary-cloud ist nicht betroffen**, aber das dortige Skript wurde nicht
  abgeglichen.~~ **Erledigt am 2026-09-20** — siehe [Nachtrag](#nachtrag-2026-09-20--wieder-deckungsgleich-mit-panary-cloud).
- **Die Deckungsgleichheit ist ein Zustand, kein Gate.** Nichts hindert den nächsten
  einseitigen Edit, und keine der beiden CIs prüft die Dateien gegeneinander. Wer eine
  aktuelle Aussage braucht, misst sie:
  `diff <(git -C panary-core show origin/main:scripts/security-scan.mjs) <(git -C panary-cloud show origin/main:scripts/security-scan.mjs)`

## Nachtrag 2026-09-20 — wieder deckungsgleich mit panary-cloud

panary-cloud hat diesen Stand aufgegriffen und dabei einen eigenen Befund mitgenommen:
Dort gibt es **zwei** committete Lockfiles, und der lokale Scan maß nur eines
([panary/panary-cloud#490](https://github.com/panary/panary-cloud/issues/490)). Die dortige
Fassung löst die Lockfiles deshalb über `git ls-files '*pnpm-lock.yaml'` auf — eine echte
**Obermenge**: Hier liefert sie genau ein Lockfile, und der Symlink-Schutz oben greift
unverändert.

Übernommen wurde sie **nicht wörtlich**. Die cloud-Fassung trug in ihren Kommentaren bare
Issue-Nummern und cloud-eigene Tatsachen; `#274` ist in diesem Repo „Kassenbon druckt
Uhrzeit in UTC statt Filialzeit", also ein völlig anderes Ticket, und Sätze wie „this repo
has TWO committed ones" wären hier schlicht falsch. Eine Kopie hätte falsche Verweise und
falsche Aussagen in den Code gebracht. Stattdessen ist der Kommentarteil **repo-neutral**
formuliert: Wo repo-spezifische Tatsachen nötig sind, werden beide Repos benannt (in beiden
wahr), und Issue-Verweise sind vollqualifiziert. Dieselbe Fassung steht jetzt in beiden
Repos.

**Gemessen, dass sich hier nichts ändert** — ein Verhaltens-Delta war nicht erwartet, und
genau deshalb ausdrücklich nachgewiesen statt behauptet (`origin/main` @ `9a4baadd`,
osv-scanner 2.3.8):

| Lage | alter Stand | neuer Stand |
| --- | --- | --- |
| Arbeitsbaum (echte Datei) | `./pnpm-lock.yaml — Arbeitsbaum`, 0 Befunde | `1 Lockfile: ./pnpm-lock.yaml — Arbeitsbaum`, 0 Befunde |
| Symlink aus dem Repo heraus | `committeter Stand HEAD@9a4baadd`, 0 Befunde | `committeter Stand HEAD@9a4baadd`, 0 Befunde |
| `adm-zip@0.6.0` eingeschleust | — | **2 Befunde** (GHSA-7q85-xj36-vmfc high, GHSA-vwc7-r8mq-g2x9 medium) |

Einziger sichtbarer Unterschied ist die Wortwahl der Lockfile-Zeile (`lockfile:` →
`1 Lockfile:`). Befunde tragen ihre Quelldatei erst, wenn **mehr als eine** gemessen wird —
in diesem Repo also nie, solange es ein Lockfile gibt.

⚠️ **Die Symlink-Probe zeigte bewusst nicht aufs Workbench-Root-Lockfile.** Ein
`git checkout -- pnpm-lock.yaml` schreibt durch einen solchen Symlink hindurch und
überschreibt die **ungetrackte** Datei am Workbench-Root — per git nicht wiederherstellbar.
Das Probenziel lag deshalb in einem Wegwerf-Verzeichnis, und zurückgesetzt wurde mit
`rm` **vor** `git checkout`.

## Verwandt

- [Der lokale Security-Scan lief blind](lokaler-security-scan-blind.md) — dieselbe
  Klasse, ein Jahr näher an der Wurzel: Dort meldete ein ausgefallener Scan grün, hier
  ein Scan über den falschen Baum. Der Symlink stand dort bereits unter „Was das nicht
  löst".
- [OSV-Befund 2026-09-15](osv-befund-2026-09-15.md) — der Override-Floor `adm-zip ^0.6.1`,
  der im core-Lockfile greift und im Workbench-Root fehlt.
- Schwester-Befund in panary-cloud: `docs/security/lokaler-security-scan-zwei-lockfiles.md`
  ([panary/panary-cloud#490](https://github.com/panary/panary-cloud/issues/490)) — dort war
  es nicht der falsche Baum, sondern nur die halbe Fläche.
