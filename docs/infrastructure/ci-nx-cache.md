---
type: Architecture
title: CI-Nx-Cache — Remote-Cache bei Push, GitHub-Actions-Cache bei PR
description: Woher die core-CI ihre Nx-Treffer bekommt — main-Läufe aus dem Remote-Cache, PR-Läufe aus einem rollierenden GitHub-Actions-Cache des jüngsten main-Stands —, warum es dafür kein Read-Only-Token gibt, wie die Task-DB über die Maschinen-ID hinweg übernommen wird und was der Deckel gegen das volle Cache-Kontingent tut.
tags: [ci, infra, nx]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-10T02:30:00Z }
sources:
  - id: issue-1376
    resource: https://github.com/panary/panary-core/issues/1376
    title: Plan, Messung (0 % Treffer in PR-Läufen) und Review
  - id: ci-yml
    resource: .github/workflows/ci.yml
    title: Job main (Schritte „Nx-Cache …“) und Job nx-cache-aufraeumen
  - id: issue-1402
    resource: https://github.com/panary/panary-core/issues/1402
    title: Notice-Größe über dem Deckel, Ursache und Messung
  - id: nx-cache-mass
    resource: scripts/nx-cache-mass.mjs
    title: Messung der Nx-Cache-Notices
---

# CI-Nx-Cache

Die core-CI (`.github/workflows/ci.yml`, Job `main`) läuft auf GitHub-hosted Runnern, die bei
jedem Lauf leer starten. Woher ein Lauf Nx-Treffer bekommt, hängt am Ereignis:

| Ereignis | Remote-Cache | GitHub-Actions-Cache |
| --- | --- | --- |
| Push auf `main`, Dispatch auf `main` | lesen und schreiben (RW-Token) | herstellen, danach ergänzt sichern |
| Pull Request | nein | nur herstellen |

## Warum PRs den Remote-Cache nicht lesen

Der Remote-Cache-Server kennt **ein** Token, und das darf lesen und schreiben. Ein Token mit
Schreibrecht in PR-Läufen wäre ein Vergiftungsweg (Cache-Poisoning, CVE-2025-36852): Ein PR könnte
Artefakte unter einem Hash ablegen, die ein späterer `main`-Lauf als Treffer übernimmt. Ein
Read-Only-Token gibt es auf dem Server nicht. Die env-Bedingung in `ci.yml` sieht
`NX_CACHE_RO_TOKEN` zwar vor, das Secret ist aber leer. Betrieb und Server sind intern in
panary-cloud dokumentiert („nx-remote-cache“).

Ohne den Actions-Cache meldete deshalb jeder untersuchte PR-Lauf (26.10.–08.11.2026)
`Cache: 0/… hit (0%)`. Selbst ein PR mit fünf betroffenen Projekten baute 123 Tasks neu.

## Der GitHub-Actions-Cache als Lesepfad

Ein PR darf Cache-Einträge seines Basis-Branches und des Default-Branches lesen. Schreiben kann
er nur in seinen eigenen Bereich (`refs/pull/…`), und von dort liest kein `main`-Lauf. Ein
Vergiftungsweg entsteht so nicht, auch nicht aus Fork- oder Dependabot-PRs. Dass ein PR keinen
`nx-*`-Eintrag anlegt, regeln die `if`-Bedingungen der Sicher-Schritte. Das Recht dazu hätte er
im eigenen Bereich, der Pnpm-Cache von `setup-node` nutzt es bei geändertem Lockfile auch.

1. **`NX_CACHE_DIRECTORY=.nx/cache`** im Job-Env. Nx 23 legt Cache und Task-DB sonst unter
   `~/.nx/<hash>/` ab, außerhalb des Checkouts. Mit der Variablen liegen beide wieder im Workspace
   (`.nx/cache`, `.nx/workspace-data`). Bewusst nicht als `cacheDirectory` in `nx.json`: Das würde
   lokal das Cache-Teilen zwischen den Worktrees abschalten.
2. **Herstellen** (alle Läufe): `actions/cache/restore` mit dem Präfix `nx-Linux-` holt den
   jüngsten Eintrag nach `.nx/ci-transfer`.
3. **Übernehmen:** Die Cache-Dateien kommen nach `.nx/cache`, danach wird die Task-DB übernommen
   (siehe unten).
4. **Sichern** (nur `main`, auch nach rotem affected-Schritt, nicht nach Abbruch): Cache und DB
   kommen nach `.nx/ci-transfer`, `actions/cache/save` legt sie unter
   `nx-Linux-<sha>-<run_id>-<attempt>` ab. Lauf-ID und Versuch stehen im Schlüssel, weil ein
   Re-Run desselben SHA sonst einen belegten Schlüssel fände und nichts sichern würde. Weil der
   Lauf vorher den letzten Stand hergestellt hat, wächst der Eintrag über die Läufe. Ein Push
   baut nur seine eigenen Änderungen und hinterließe ohne Herstellen einen fast leeren Eintrag.
5. **Aufräumen:** Der Job `nx-cache-aufraeumen` löscht alle `nx-Linux-*`-Einträge auf `main`
   außer dem neuesten. Er braucht `actions: write`. Deshalb ist er ein eigener Job, der nur die
   GitHub-API aufruft. Der Job `main` führt Repo-Code aus und bekommt das Recht nicht.

## Die Task-DB und die Maschinen-ID

Nx beantwortet einen Treffer aus seiner SQLite-Task-DB. Die Dateien unter `.nx/cache/<hash>/`
allein genügen nicht. Die DB heißt `<Maschinen-ID>-v4.db` (Nx 23.3.1). Die ID liest Nx unter Linux
aus `/var/lib/dbus/machine-id` bzw. `/etc/machine-id`, notfalls aus dem Hostnamen. Ein anderer
Runner sucht also womöglich eine andere Datei.

Den Namen rät der Übernahme-Schritt deshalb nicht. Er lässt Nx seine eigene, leere DB anlegen
(`getDbConnection()` aus `nx/src/utils/db-connection`) und ersetzt deren Inhalt durch die
gesicherte DB. Lokal nachgestellt mit `design-tokens:typecheck`:

| Zustand nach dem Herstellen | Ergebnis |
| --- | --- |
| Cache-Dateien da, DB von einem anderen Namen übernommen | `Cache: 1/1 hit (100%)` |
| Cache-Dateien da, nur die frisch angelegte leere DB | `Cache: 0/1 hit (0%)` |

Der Schritt kennt auch den Suffix nicht (`*.db` mit `nullglob`). Ein Nx-Update auf `-v5` lässt
ihn deshalb nicht still eine Datei mit Literal-Namen anlegen.

Cache und DB gehören zusammen. Eine DB ohne die Dateien wäre schlimmer als gar nichts: Nx meldet
dann `[local cache]` und stellt nichts her. Deshalb werden beide gemeinsam gesichert und
gemeinsam übernommen. Findet der Schritt nicht genau eine DB auf jeder Seite, verwirft er beides,
und der Lauf startet leer.

**Kein Schritt färbt die CI rot.** Übernehmen, Bereitlegen und Aufräumen schalten `-e` mit
`set +e` ausdrücklich ab. GitHub startet `shell: bash` als `bash -e -o pipefail`, ein bloßes
`set -uo pipefail` ließe `-e` also stehen (so im ersten Lauf nach dem Merge gesehen). Jeder Fehler (ein verschobener Nx-Modulpfad nach einem Update, eine nicht anlegbare DB,
ein Löschversuch mit 404) wird zur `::warning` „Nx-Cache“, und der Lauf geht ohne Cache weiter.
Lokal nachgestellt mit einem absichtlich falschen Modulpfad: Warnung, Exit 0, `.nx/cache`
aufgeräumt.

## Größe und Kontingent

Das Cache-Kontingent des Repos liegt bei 10 GB. Am 2026-11-08 war es schon voll: 10,5 GB in 125
Einträgen, vor allem CodeQL (4,6 GB), Rust-Builds der POS-Pakete (3,2 GB) und buildkit (1 GB).
GitHub verdrängt per LRU. Jeder Nx-Eintrag schiebt also fremde Einträge hinaus, zuerst die selten
genutzten Rust-Caches.

- `NX_MAX_CACHE_SIZE: 1GB` im Job-Env deckelt den lokalen Cache, also auch den gesicherten Eintrag.
  Bewusst nicht als `maxCacheSize` in `nx.json`, das würde auch den lokal geteilten Cache deckeln.
- Das Aufräumen hält genau einen Nx-Eintrag. Das Kontingent zählt das **gepackte** Archiv, und das
  lag bei 2,2 GB auf der Platte bei 134–145 MB
  ([#1402](https://github.com/panary/panary-core/issues/1402)). Der Aufschlag auf das Kontingent
  ist also rund ein Siebtel des Deckels, nicht der Deckel selbst.

### Wonach der Deckel rechnet

Nx 23.3.1 verdrängt am Ende jedes Laufs (`removeOldCacheRecords`) in zwei Schritten, beide in der
Task-DB:

1. Zeilen, deren `accessed_at` älter als sieben Tage ist, fallen weg.
2. Ist `SELECT SUM(size) FROM cache_outputs` danach größer als der Deckel, löscht Nx die ältesten
   Zeilen nach `accessed_at`, je hundert auf einmal, bis die Summe darunter liegt.

`size` ist die Summe der Dateigrößen eines Eintrags in Bytes, gesammelt beim Ablegen. Die Summe
läuft über **alle** Zeilen, auch über reine Terminal-Ausgaben ungecachter Tasks
(`is_cache_entry = 0`). `du` zählt dagegen belegte Blöcke. Bei tausenden kleinen Ausgabedateien
liegt das ein Vielfaches höher. Lokal gemessen an einem Nx-23-Cache mit 2761 Einträgen: DB-Summe
4,21 GB, Dateigröße auf der Platte 4,21 GB, `du` 6,22 GB. Die Notices zeigten bis [#1402](https://github.com/panary/panary-core/issues/1402) die
`du`-Zahl und lagen deshalb über dem Deckel, ohne dass er versagt hatte. Die erste neue Notice
([PR #1405](https://github.com/panary/panary-core/pull/1405), Cache des jüngsten `main`-Laufs auf dem Linux-Runner): 438 Einträge, Nx-Maß 962 MB
von 1 GB, Dateigröße 962 MB, belegt 2,47 GB, 0 Verzeichnisse ohne DB-Zeile. Der Block-Aufschlag
dort ist also rund das 2,6-Fache.

Daraus folgt auch: **Sinkende Einträge sind unter dem Deckel normal.** Ist er erreicht, verdrängt
jeder große neue Eintrag mehrere kleine alte. Die Zahl wächst nur, bis der Deckel greift.

### Reicht 1 GB? Das Alter beim Sichern

Ob der Deckel Einträge wegwirft, die noch gebraucht würden, zeigt das Alter der ältesten Zeile in
der Notice **„Nx-Cache gesichert“**, also nach der Verdrängung, gelesen zusammen mit dem Nx-Maß
derselben Notice ([#1407](https://github.com/panary/panary-core/issues/1407)):

| beim Sichern | Lesart |
| --- | --- |
| ältester Zugriff nahe sieben Tagen | Die Altersregel verdrängt. Mehr Platz bringt wenig. |
| ältester Zugriff deutlich jünger, Nx-Maß nahe am Deckel | Der Deckel wirft Einträge weg, die noch keine Woche alt sind. Ein Argument für 2 GB. |
| ältester Zugriff jünger, Nx-Maß deutlich unter dem Deckel | Es wird nicht verdrängt. |

🚨 **Erst Läufe ab 2026-11-15 19:00 UTC zählen.** Der Actions-Cache-Pfad kam am 2026-11-08 18:55 UTC
([#1376](https://github.com/panary/panary-core/issues/1376)), der erste gesicherte Lauf startete leer.
Bis eine Woche danach ist der älteste Zugriff zwangsläufig jünger als sieben Tage, ganz gleich, was
verdrängt wird. Die älteste Anlage in derselben Zeile macht das sichtbar: Liegt sie unter sieben
Tagen, ist der Cache selbst noch jünger als die Altersregel.

Gewertet werden nur `main`-Läufe, die Tasks ausgeführt oder getroffen haben (`Cache: n/m` mit
m > 0). Ein Lauf ohne Tasks frischt kein `accessed_at` auf. Die Entscheidung über den Deckel trifft
Michael.

### Die Notices

Beide Notices („Nx-Cache“ beim Übernehmen, „Nx-Cache gesichert“ beim Bereitlegen) kommen aus
`scripts/nx-cache-mass.mjs`:

| Angabe | Quelle | Wofür |
| --- | --- | --- |
| Einträge laut DB, Zeilen | `cache_outputs`, `is_cache_entry = 1` bzw. alle | Einträge, die Nx als Treffer kennt |
| Nx-Maß von Deckel | `SUM(size)` über alle Zeilen gegen `NX_MAX_CACHE_SIZE` | das, was Nx vergleicht; „ÜBER DEM DECKEL“ heißt, die Verdrängung greift nicht |
| Platte: Dateigröße / belegt | Byte-Summe bzw. Blöcke × 512 | Block-Aufschlag des Runners |
| Hash-Verzeichnisse, davon ohne DB-Zeile | Verzeichnisse unter `.nx/cache` gegen die DB | verwaiste Einträge, die Nx nie verdrängt |
| WAL (nur beim Sichern) | Größe der `*.db-wal` | gesichert wird nur die `.db`; ein volles WAL fehlte der Kopie |
| ältester / jüngster Zugriff, älteste Anlage | `MIN`/`MAX(accessed_at)`, `MIN(created_at)` als Alter (h unter einem Tag, sonst d) | Lesart oben; nach `accessed_at` verdrängt Nx. Eigene Abfrage: Fehlt eine Spalte, steht „Alter nicht messbar: …“, die Größen bleiben. Leere DB: „Alter: keine Zeilen“ |

Die Messung endet immer mit Exit 0. Ihr Spec `scripts/nx-cache-mass.spec.mjs` läuft als eigener
CI-Schritt.

Die Zeitstempel schreibt SQLite per `CURRENT_TIMESTAMP` als `YYYY-MM-DD HH:MM:SS` in UTC, ohne
Zone. Ein naives `new Date()` läse das als Ortszeit. Das Skript liest sie deshalb von Hand als UTC,
der Spec startet den Aufruf-Test mit `TZ=Europe/Berlin`. Der CI-Runner läuft in UTC und sähe die
falsche Lesart sonst nie.

## Was das nicht abdeckt

- **Kalte Läufe sind still.** Ein verdrängter oder fehlender Eintrag macht einen Lauf wieder kalt,
  ohne dass etwas rot wird. Erkennbar ist das nur an der Notice „Kein gesicherter Nx-Cache“ und an
  `Cache: 0/…`.
- **Treffer ohne Dateien** melden Exit 0. Die Übernahme ist darauf ausgelegt, das zu verhindern.
  Belegt ist es nur stichprobenhaft über Tasks, die einen `[local cache]`-Build voraussetzen.
- **Fork-PRs** profitieren nur, wenn es auf `main` einen Eintrag gibt.
- Die ersten Läufe nach der Einführung sind dünn. Erst der rollierende Cache sammelt die
  `^build`-Ergebnisse der unbetroffenen Libs an. Ein `workflow_dispatch` hilft dabei kaum: Er
  fährt nur `run-many -t lint`, also keine `test`-, `typecheck`- oder `build`-Einträge. Vom
  Feature-Branch aus ist ein Dispatch ohnehin tabu, denn er bekäme das RW-Token des Remote-Caches.
- **Die Verdrängungsregel** ist aus den SQL-Texten im nativen Nx-Modul abgelesen, nicht aus dem
  Rust-Quelltext. Dass die Summe unter dem Deckel bleibt, belegt eine einzelne Notice
  ([PR #1405](https://github.com/panary/panary-core/pull/1405)), noch keine Reihe von Läufen.
- **Das Alter misst nur die Nutzung durch `main`.** Ein PR-Lauf schreibt seine DB nicht zurück. Ein
  Eintrag, den nur PRs treffen, sieht deshalb alt aus und wird früher verdrängt, als seine Nutzung
  rechtfertigt. Ob 2 GB die PR-Trefferquote hebt, zeigte erst ein Vergleich nach dem Anheben.
- **Die Shell-Logik ist nicht als Spec getestet**, nur lokal mit den Fällen oben nachgestellt. Sie
  steht inline im Workflow, und belegt wird sie über die Verifikation nach dem Merge
  ([#1376](https://github.com/panary/panary-core/issues/1376)).

## Siehe auch

- [ADR 0038 — Reihenfolge-Gate](../adr/0038-shuffle-gate-mit-commit-seed.md): läuft mit
  `--skip-nx-cache` und nutzt diesen Cache bewusst nicht.
- [CI-Log — der Exit von Nx](ci-log-nx-exit-an-der-pipe.md): der Remote-Cache-Retry im
  affected-Schritt.
