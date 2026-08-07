---
type: ADR
title: Format-Gate prüft workspace-weit — --all statt --base, Bestand aufgeräumt statt Baseline
description: Das Format-Gate läuft mit --all über den gesamten Workspace statt nur über die gegen main geänderten Dateien; der vorbestehende Bestand wird einmalig mechanisch aufgeräumt, weil er anders als beim Typecheck mit einem Befehl behebbar ist.
tags: [ci, tooling, prettier, format, infra]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-07T19:10:00.000Z }
---

# Format-Gate prüft workspace-weit

## Problem

Dieses Repo hatte **kein Format-Gate**. Kein Workflow rief `format:check` auf — die
Formatierung ist hier nie geprüft worden, von keinem Lauf. Gemessen am 2026-08-07 gegen
`origin/main` waren **348 von 1828** getrackten Dateien nicht Prettier-konform (19 %).

Der naheliegende Fix wäre gewesen, den Schritt aus panary-cloud zu übernehmen:

```yaml
- run: pnpm nx record -- pnpm nx format:check --base="remotes/origin/main"
```

Der prüft aber ausschließlich Dateien, die **gegen main** geändert wurden — auf `main`
selbst also nie. Ein solches Gate hält den Bestand nicht, es verschiebt ihn nur: Drift
wächst auf main unbemerkt weiter und schlägt erst zu, wenn jemand eine Datei aus einem
ganz anderen Grund anfasst. Dann bricht **sein** PR an fremder Schuld ab. Belegt in
panary-cloud [#95](https://github.com/panary/panary-cloud/pull/95): Der Lauf scheiterte an
21 Dateien, und einzeln gegen ihre `origin/main`-Fassung geprüft waren **alle 21** schon
vorher nicht konform. Keine einzige Abweichung stammte aus der eigentlichen Änderung.

Das ist dasselbe Muster wie bei zwei anderen Gates desselben Tages: Das `typecheck`-Target
lief workspace-weit gar nicht ([ADR 0021](0021-keine-ts-projekt-referenzen-ohne-solution-setup.md),
[Nx-Typecheck-Target](../infrastructure/nx-typecheck-target.md)), und der Security-Audit
schlug erst an, als ein neues Advisory erschien. Alle drei sehen nur Deltas oder liefen
nicht — und in allen drei Fällen war der Bestand über Monate gewachsen.

### Ein zweiter Befund: der Bestand war lokal gar nicht messbar

`nx format:check --all` liefert in einem Arbeits-Checkout ein **falsches** Ergebnis.
Verschachtelte Agent-Worktrees unter `.claude/worktrees/` sind lokale Checkouts dieses
Repos selbst; sie stehen nur in `.git/info/exclude`, sind also nicht eingecheckt, aber
Prettier scannt sie mit. In panary-cloud sind das 2319 Dateien. Die Ausgabe bricht dadurch
**mitten in einem Pfad ab** (letzte Zeile: `.claude/worktree`) und erreicht `apps/` und
`libs/` nie: gemeldet werden 695 Worktree-Dateien und **null** echte Quelldateien.

In der CI tritt das nicht auf — ein frischer Checkout hat keine verschachtelten Worktrees.
Lokal verfälscht es jede Messung, und zwar in die gefährliche Richtung: Der Lauf sieht
erfolgreich aus, obwohl er den Quellbaum nie gesehen hat. Dieselbe Klasse wie der
`osv-scanner`, der aus einem Worktree heraus „No package sources found" meldet und dabei
grün ist.

## Entscheidung

**1. `--all` statt `--base`.** Das Gate prüft den gesamten Workspace, nicht das Delta:

```yaml
- name: Format-Gate (workspace-weit)
  run: pnpm nx format:check --all
```

Auch nicht `affected`: Die Aussage soll über den ganzen Workspace gelten, und ein
affected-Lauf könnte „nicht geprüft" nicht von „konform" unterscheiden — genau die
Zweideutigkeit, die den Bestand hat entstehen lassen.

**2. Aufräumen statt Baseline.** Der Bestand wird einmalig mechanisch beseitigt
(`nx format:write --all`, 341 Dateien, Commit `29b2ba6`), danach steht das Gate hart.

Hier trennt sich der Fall bewusst vom Typecheck-Gate. Dort steht in panary-cloud ein
Baseline-Gate (`scripts/typecheck-gate.mjs`), weil hinter den 332 Fehlern echte
Ingenieursarbeit steckt — Treibertypen, Resolver-Signaturen, vier Laufzeitdefekte. Ein
hartes Gate wäre dort an Tag eins rot gewesen und hätte sofort wieder ausgeschaltet werden
müssen. Formatierung dagegen ist zu 100 % mechanisch behebbar: ein Befehl, und der Bestand
ist weg. Eine Baseline wäre hier nicht nur Maschinerie ohne Inhalt — sie würde den Bestand
**konservieren**, dessen Beseitigung nichts kostet.

**3. `.claude/worktrees/` in `.prettierignore`.** Damit ist der Befund oben lokal geheilt
und nicht nur in der CI umgangen. Dazu `pnpm-lock.yaml` (pnpm verwaltet das Format selbst,
jeder Install dreht eine Prettier-Fassung zurück — panary-cloud ignoriert es aus diesem
Grund bereits) sowie `.agents/skills/` und `_planning/` als vendortes bzw. Prosa-Material,
analog zum bereits ignorierten `/docs`.

**4. Angular-Parser für Templates.** Prettier wählt den Parser nach Dateiendung, `.html`
bekommt also den `html`-Parser. Der kennt Angulars Control-Flow-Blöcke nicht und reflowt
`@if`/`@for` als Fließtext. Ein `overrides`-Block in `.prettierrc` bindet
`apps/**/src/**/*.html` und `libs/**/*.html` an `parser: "angular"`;
`tools/hosting/get.panary.cloud/index.html` bleibt bewusst beim `html`-Parser, das ist eine
echte statische Seite.

## Konsequenzen

- Der Sweep-Commit `29b2ba6` ist mit 341 Dateien groß und rein mechanisch. Er steht allein
  und ist in `.git-blame-ignore-revs` eingetragen. GitHub wertet die Datei automatisch aus;
  lokal ist sie einmalig scharf zu schalten:

  ```bash
  git config blame.ignoreRevsFile .git-blame-ignore-revs
  ```

  Wer künftig einen weiteren rein mechanischen Commit erzeugt, trägt ihn dort nach — sonst
  verdeckt er `git blame`.

- Das Gate ist ab jetzt an Tag eins grün und bleibt es. Ein PR, der Formatierung verletzt,
  bricht ab — an eigener Schuld, nicht an fremder.

- **Prettier-Versionsbumps sind ab jetzt Breaking Changes für das Gate.** Ein Minor-Bump
  ändert den Output und färbt den Workspace workspace-weit rot. Ein solcher Bump gehört
  deshalb zusammen mit einem erneuten `format:write` in einen eigenen, allein stehenden
  Commit — und dieser wieder in `.git-blame-ignore-revs`. Aus demselben Grund ziehen core
  und cloud dieselbe Version (`~3.8.4`).

- Neue Verzeichnisse mit vendortem Fremdmaterial gehören in `.prettierignore`, nicht in den
  Sweep. Sonst wird Fremdcode an den Hausstil angepasst und weicht bei jedem
  Upstream-Update erneut ab.

- panary-cloud fährt dieselbe Entscheidung in
  [ADR 0041](https://github.com/panary/panary-cloud/blob/main/docs/adr/0041-format-gate-ohne-base.md).
  Beide Repos sind eigenständig, die Entscheidung ist deshalb bewusst dupliziert — wie schon
  bei ADR 0021 / cloud ADR 0038.
