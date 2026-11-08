---
type: Architecture
title: CI-Nx-Cache — Remote-Cache bei Push, GitHub-Actions-Cache bei PR
description: Woher die core-CI ihre Nx-Treffer bekommt — main-Läufe aus dem Remote-Cache, PR-Läufe aus einem rollierenden GitHub-Actions-Cache des jüngsten main-Stands —, warum es dafür kein Read-Only-Token gibt, wie die Task-DB über die Maschinen-ID hinweg übernommen wird und was der Deckel gegen das volle Cache-Kontingent tut.
tags: [ci, infra, nx]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-08T19:00:00Z }
sources:
  - id: issue-1376
    resource: https://github.com/panary/panary-core/issues/1376
    title: Plan, Messung (0 % Treffer in PR-Läufen) und Review
  - id: ci-yml
    resource: .github/workflows/ci.yml
    title: Job main (Schritte „Nx-Cache …“) und Job nx-cache-aufraeumen
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

Ein PR darf Cache-Einträge seines Basis-Branches lesen, schreibt aber nur in seinen eigenen
Bereich, und den nutzt dieser Workflow nicht. Ein Vergiftungsweg entsteht so nicht, auch nicht
aus Fork- oder Dependabot-PRs.

1. **`NX_CACHE_DIRECTORY=.nx/cache`** im Job-Env. Nx 23 legt Cache und Task-DB sonst unter
   `~/.nx/<hash>/` ab, außerhalb des Checkouts. Mit der Variablen liegen beide wieder im Workspace
   (`.nx/cache`, `.nx/workspace-data`). Bewusst nicht als `cacheDirectory` in `nx.json`: Das würde
   lokal das Cache-Teilen zwischen den Worktrees abschalten.
2. **Herstellen** (alle Läufe): `actions/cache/restore` mit dem Präfix `nx-Linux-` holt den
   jüngsten Eintrag nach `.nx/ci-transfer`.
3. **Übernehmen:** Die Cache-Dateien kommen nach `.nx/cache`, danach wird die Task-DB übernommen
   (siehe unten).
4. **Sichern** (nur `main`, auch nach rotem affected-Schritt, nicht nach Abbruch): Cache und DB
   kommen nach `.nx/ci-transfer`, `actions/cache/save` legt sie unter `nx-Linux-<sha>` ab. Weil der
   Lauf vorher den letzten Stand hergestellt hat, wächst der Eintrag über die Läufe. Ein Push
   baut nur seine eigenen Änderungen und hinterließe ohne Herstellen einen fast leeren Eintrag.
5. **Aufräumen:** Der Job `nx-cache-aufraeumen` löscht alle `nx-Linux-*`-Einträge auf `main`
   außer dem neuesten. Er braucht `actions: write`. Deshalb ist er ein eigener Job, der nur die
   GitHub-API aufruft. Der Job `main` führt Repo-Code aus und bekommt das Recht nicht.

## Die Task-DB und die Maschinen-ID

Nx beantwortet einen Treffer aus seiner SQLite-Task-DB. Die Dateien unter `.nx/cache/<hash>/`
allein genügen nicht. Die DB heißt `<Maschinen-ID>-v4.db`, und die ID stammt aus der Maschine
(Linux: `/etc/machine-id`). Ein anderer Runner sucht also eine andere Datei.

Den Namen rät der Übernahme-Schritt deshalb nicht. Er lässt Nx seine eigene, leere DB anlegen
(`getDbConnection()` aus `nx/src/utils/db-connection`) und ersetzt deren Inhalt durch die
gesicherte DB. Lokal nachgestellt mit `design-tokens:typecheck`:

| Zustand nach dem Herstellen | Ergebnis |
| --- | --- |
| Cache-Dateien da, DB von einem anderen Namen übernommen | `Cache: 1/1 hit (100%)` |
| Cache-Dateien da, nur die frisch angelegte leere DB | `Cache: 0/1 hit (0%)` |

Cache und DB gehören zusammen. Eine DB ohne die Dateien wäre schlimmer als gar nichts: Nx meldet
dann `[local cache]` und stellt nichts her. Deshalb werden beide gemeinsam gesichert und
gemeinsam übernommen. Findet der Schritt nicht genau eine DB auf jeder Seite, verwirft er beides,
und der Lauf startet leer.

## Größe und Kontingent

Das Cache-Kontingent des Repos liegt bei 10 GB. Am 2026-11-08 war es schon voll: 10,5 GB in 125
Einträgen, vor allem CodeQL (4,6 GB), Rust-Builds der POS-Pakete (3,2 GB) und buildkit (1 GB).
GitHub verdrängt per LRU. Jeder Nx-Eintrag schiebt also fremde Einträge hinaus, zuerst die selten
genutzten Rust-Caches.

- `NX_MAX_CACHE_SIZE: 1GB` im Job-Env deckelt den lokalen Cache, also auch den gesicherten Eintrag.
  Bewusst nicht als `maxCacheSize` in `nx.json`, das würde auch den lokal geteilten Cache deckeln.
- Das Aufräumen hält genau einen Nx-Eintrag. Der Aufschlag auf das Kontingent bleibt damit bei
  höchstens rund 1 GB statt einem Eintrag je Push.
- Die tatsächliche Größe steht bei jedem Sichern als `::notice` „Nx-Cache gesichert“ im Log. Ist
  der Deckel nach einigen Läufen erreicht oder weit unterschritten, wird er hier nachgezogen.

## Was das nicht abdeckt

- **Kalte Läufe sind still.** Ein verdrängter oder fehlender Eintrag macht einen Lauf wieder kalt,
  ohne dass etwas rot wird. Erkennbar ist das nur an der Notice „Kein gesicherter Nx-Cache“ und an
  `Cache: 0/…`.
- **Treffer ohne Dateien** melden Exit 0. Die Übernahme ist darauf ausgelegt, das zu verhindern.
  Belegt ist es nur stichprobenhaft über Tasks, die einen `[local cache]`-Build voraussetzen.
- **Fork-PRs** profitieren nur, wenn ihr Basis-Stand einen Eintrag hat. Ein PR gegen einen
  anderen Branch als `main` findet keinen.
- Die ersten Läufe nach der Einführung sind dünn. Erst der rollierende Cache sammelt die
  `^build`-Ergebnisse der unbetroffenen Libs an. Ein `workflow_dispatch` auf `main` baut alle
  Projekte (`run-many`) und füllt den Eintrag auf einen Schlag. Vom Feature-Branch aus ist ein
  Dispatch tabu: Er bekäme das RW-Token des Remote-Caches.

## Siehe auch

- [ADR 0038 — Reihenfolge-Gate](../adr/0038-shuffle-gate-mit-commit-seed.md): läuft mit
  `--skip-nx-cache` und nutzt diesen Cache bewusst nicht.
- [CI-Log — der Exit von Nx](ci-log-nx-exit-an-der-pipe.md): der Remote-Cache-Retry im
  affected-Schritt.
