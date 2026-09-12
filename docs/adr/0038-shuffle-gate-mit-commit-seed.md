---
type: ADR
title: Reihenfolge-Gate für api-edge — Shuffle-Lauf mit Seed aus dem Commit, ohne Nx-Cache
description: Der api-edge-Testlauf läuft in der CI ein zweites Mal mit gemischter Datei- und Testreihenfolge; der Seed stammt aus der Commit-SHA und der Nx-Cache ist abgeschaltet, damit der Schritt nicht grün meldet, ohne gemessen zu haben.
tags: [ci, tests, vitest, gates, api-edge, infra]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-09-13T00:45:00.000Z }
---

# Reihenfolge-Gate für api-edge

## Problem

Alle Suiten unter `apps/api-edge/test/` laufen gegen **eine** SQLite-Datei
(`vitest.config.mts`, `test.env.SQLITE_PATH`). Vitest kann `env` nicht je Datei
setzen, deshalb steht dort `fileParallelism: false`. Das serialisiert die Dateien —
es sortiert sie nicht. Wer seinen Datensatz in `beforeAll` aufbaut und über mehrere
Tests hinweg patcht, macht die Testreihenfolge zum stillen Teil seiner Annahme.

Am 2026-09-13 traf das **vier** Suiten gleichzeitig
([#301](https://github.com/panary/panary-core/issues/301)). Ohne Shuffle waren alle
831 Tests grün; mit `--sequence.shuffle` fiel je nach Seed ein bis zwei Tests aus, und die
Meldungen zeigten in die falsche Richtung — `2000 !== 4000` in einer Order, die ein
Nachbartest rabattiert hatte, `NotFound` auf einen Tenant, den ein Nachbartest anlegt.
Von 16 gemessenen Seeds waren 10 rot (1–3, 8–14); die Ausgangsmeldung hatte über vier
Läufe mit zufälligem Seed drei bis fünf rote Tests gesehen.

Zwei Eigenschaften machten den Befund unsichtbar:

1. **`--sequence.shuffle` mischt auch die Tests *innerhalb* einer Datei.** Vitest
   dokumentiert `shuffle: true` als „files **and** tests"; gelesen wurde es als
   Datei-Schalter. Alle vier Kopplungen lagen innerhalb je einer Datei.
2. **Der Bestands-Suchbefehl aus `code-style.md` §10.1 kann sie nicht finden.** Er
   filtert auf `*.spec.ts` — die Integrationstests heissen `*.test.ts` — und sucht
   Zuweisungen in `beforeEach`, während der geteilte Zustand hier eine Datenbankzeile
   aus `beforeAll` ist. Er meldete „0 Treffer", während vier Suiten gekoppelt waren.

Der Umbau nach §10.1 (Datensatz je Test, `onTestFinished`) behebt den Bestand. Die
offene Frage ist der Rückfall: Ohne Prüfung wächst dasselbe Muster still nach, und
der nächste Fund kostet wieder einen halben Tag Diagnose — der Shuffle-Lauf selbst
ist als Werkzeug unbrauchbar, solange er ohnehin rot ist.

## Entscheidung

Die CI bekommt einen zweiten api-edge-Lauf mit `--sequence.shuffle`
(`.github/workflows/ci.yml`, Schritt „Reihenfolge-Gate"). Drei Festlegungen, jede
gegen einen konkreten Fehlschlag:

**Der Seed kommt aus `github.sha`, nicht aus der Uhr.** Ein Gate, das beim Re-Run
desselben Commits anders ausgeht, erzieht zum Weiterklicken — dieselbe Gewöhnung wie
`--force` bei `wt.sh done`. Mit dem Commit-Seed ist das Urteil je Commit stabil und
wandert trotzdem: Der nächste Commit prüft eine andere Permutation. Das Gate ist damit
eine **driftende Stichprobe**, keine Zufallsquelle. Der Seed steht als `::notice` im
Log, der Lauf ist mit `--sequence.seed=<n>` lokal exakt nachstellbar.

**`--skip-nx-cache`.** Bei festem Seed ist der Befehl über Re-Runs hinweg identisch;
Nx würde ihn aus dem Cache beantworten. Das wäre exakt die Klasse „sieht grün aus, ist
es aber nicht", gegen die die vier Target-Gates stehen
([nx-target-gates](../infrastructure/nx-target-gates.md)).

**Nur `api-edge`, und nur wenn es betroffen ist.** Es ist das einzige Projekt mit einer
Ressource, die über den einzelnen Test hinaus lebt; eine neue Kopplung kann nur aus einer
Änderung kommen, die api-edge betrifft. Der Rest des Workspace wurde am 2026-09-13 einmal
mitgemessen und war shuffle-grün; er bleibt ungegated, weil dort die `beforeEach`-Form
vorliegt, die der Suchbefehl aus §10.1 sehr wohl findet.

## Konsequenzen

- **Kosten:** ~1,5 min je PR, der api-edge betrifft; 0 sonst. Der Lauf kann den Cache
  nicht nutzen — das ist der Preis dafür, dass er misst.
- **Das Gate beweist keine Isolation.** Es prüft je Lauf **eine** Permutation. Grün heisst
  „unter diesem Seed keine Kopplung". Die Aussage aus `code-style.md` §10.1 bleibt
  unverändert: Isolation kommt aus der Struktur, nicht aus dem Shuffle. Das Gate fängt den
  Rückfall, nicht die Abwesenheit.
- **Ein Treffer kann aus einem fremden PR stammen.** Weil der Seed wandert, kann eine
  Kopplung erst zwei Commits später auffallen. Gemessen an #301 lagen die Trefferquoten je
  Kopplung zwischen ~30 % und ~70 % der Seeds — über drei api-edge-PRs liegt die
  Fundwahrscheinlichkeit damit bei etwa 66–97 %. Wer einen Treffer bekommt, den er nicht
  verursacht hat, repariert trotzdem einen echten Defekt; die Meldung nennt Suite und Seed.
- **Verworfen: fester Seed.** Deterministisch und nie flakig, aber er prüft für immer
  dieselbe Permutation — eine Kopplung, die unter diesem Seed nicht auffällt, ist dauerhaft
  unsichtbar. Gemessen: Von 12 Seeds fielen bei der orders-Kopplung 4 auf; ein fester Seed
  hätte sie mit 2/3 Wahrscheinlichkeit nie gefunden.
- **Verworfen: Shuffle über alle betroffenen Projekte.** Auf einem PR, der eine geteilte Lib
  anfasst, wären das bis zu ~80 Projekte ohne Cache. Der Nutzen ist dort geringer: Die
  Unit-Specs tragen die `beforeEach`-Form, die §10.1 bereits abdeckt.
