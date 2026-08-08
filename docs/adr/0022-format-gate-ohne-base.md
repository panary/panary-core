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

`nx format:check --all` liefert in einem Arbeits-Checkout ein **falsches** Ergebnis, und
zwar aus zwei sich verstärkenden Gründen.

**Erstens schneidet `nx format:check` seine Ausgabe bei exakt 64 KiB ab.** Gemessen in
panary-cloud: 65537 Bytes, danach bricht die Liste mitten in einem Pfad ab. Alles, was
alphabetisch dahinter liegt, taucht im Bericht nicht auf — dort waren das 40 Dateien.
Betroffen ist nur die **Anzeige**: Der Exit-Code stimmt weiterhin (nachgestellt mit einer
defekten `vitest.workspace.ts` am Alphabet-Ende → Exit 1, Datei benannt), und
`format:write --all` schreibt auch hinter dem Schnitt. Relevant wird die Kürzung also genau
dann, wenn man einen Massenbefund **misst** — und damit in dem Moment, in dem die Zahl über
alles Weitere entscheidet.

**Zweitens scannt Prettier die verschachtelten Agent-Worktrees mit.**
`.claude/worktrees/` enthält lokale Checkouts dieses Repos selbst; sie stehen nur in
`.git/info/exclude`, sind also nicht eingecheckt. In panary-cloud sind das 2319 Dateien —
mehr als der eigentliche Quellbaum. Zusammen mit dem 64-KiB-Schnitt meldete
`nx format:check --all` dort 695 Worktree-Dateien und **null** echte Quelldateien.

In der CI tritt beides nicht auf — ein frischer Checkout hat keine verschachtelten
Worktrees, und nach dem Aufräumen ist die Befundmenge klein. Lokal verfälscht es jede
Messung, und zwar in die gefährliche Richtung: Der Lauf sieht erfolgreich aus, obwohl er
den Quellbaum nie gesehen hat. Dieselbe Klasse wie der `osv-scanner`, der aus einem
Worktree heraus „No package sources found" meldet und dabei grün ist.

> **Messregel:** Wer eine Format-Zahl erhebt, prüft mit `prettier --check .` gegen. Der
> nx-Ausgabe ist bei großen Befundmengen nicht zu trauen.

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

### Was ein Format-Sweep trotz „rein mechanisch" brechen kann

Die Umformatierung selbst ändert kein Verhalten. Zwei Klassen hängen aber an **Zeilen**
statt an Ausdrücken und verschieben sich deshalb mit — beide sind beim Sweep aufgetreten
und beide sind vor dem nächsten Sweep zu erwarten:

**1. Zeilengebundene Lint-Direktiven.** `eslint-disable-next-line` bindet an die folgende
Zeile. Fächert Prettier einen einzeiligen Aufruf über mehrere Zeilen auf, rutscht das
abgedeckte Konstrukt aus dem Wirkungsbereich. In panary-cloud traf das
`reservations.integration.spec.ts`: zwei `no-explicit-any`-Fehler plus zwei „Unused
eslint-disable directive"-Warnungen — beide Symptome derselben Ursache. Die robuste Form
setzt die Direktive direkt über den Ausdruck, nicht über den Aufruf.

**2. Whitespace-Kinder, die Template-Regeln stumm halten.**
`@angular-eslint/template/elements-content` greift nur bei `children.length === 0`. Ein
`<button …>` mit einem bloßen Zeilenumbruch davor hat für den Angular-Parser ein
Whitespace-Textkind — die Regel schweigt. Prettier zieht das zu `></button>` zusammen, das
Scheinkind fällt weg, und der Befund liegt offen. Genau so kamen hier zwei
Farbwahl-Buttons ohne `aria-label` ans Licht (`group-form`, `group-wizard`), behoben im
Folgecommit.

Die zweite Klasse ist keine Regression, sondern eine **Freilegung**: Die Regel war nie
erfüllt, sie war nur durch einen zufälligen Umbruch stumm. Dass
`apps/admin-client/src/app/shared/language-picker.ts` denselben `></button>`-Aufbau schon
vorher hatte und trotzdem grün war, bestätigt das — der Button dort trägt ein
`[attr.aria-label]` und steht auf der Safelist der Regel.

Praktische Folge für den nächsten Sweep: `lint` **nach** dem Sweep gegen die Baseline von
`origin/main` vergleichen, nicht nur auf „grün" schauen. Nur der Vergleich trennt
Freilegung von Regression.

- panary-cloud fährt dieselbe Entscheidung in
  [ADR 0041](https://github.com/panary/panary-cloud/blob/main/docs/adr/0041-format-gate-ohne-base.md).
  Beide Repos sind eigenständig, die Entscheidung ist deshalb bewusst dupliziert — wie schon
  bei ADR 0021 / cloud ADR 0038.
