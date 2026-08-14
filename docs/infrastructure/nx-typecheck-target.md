---
type: Guide
title: Nx-Typecheck-Target — warum es jahrelang ins Leere lief und was es jetzt hält
description: Das typecheck-Target starb workspace-weit an der Konfiguration, bevor eine Datei geprüft wurde; seit der Reparatur ist es grün und läuft als hartes CI-Gate mit — api-edge fehlte bis 2026-08-14 ganz.
tags: [ci, infra, typescript, api-edge]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-14T09:40:00.000Z }
---

# Nx-Typecheck-Target

`nx run-many -t typecheck` prüft den gesamten Workspace mit
`tsc --build tsconfig.json --emitDeclarationOnly` — ein Target, das das
`@nx/js/typescript`-Plugin für jedes Projekt ableitet.

**Stand:** grün, 84 Projekte, 0 Fehler. Seit 2026-08-06 hart in der CI
(`nx affected -t lint,test,typecheck,build`).

> ⚠️ **84 von 122 Projekten — die Zahl ist die Abdeckung, nicht der Workspace.**
> Das Target wird abgeleitet, nicht deklariert: Wo keine `tsconfig.json` liegt,
> entsteht keins, und `nx affected` überspringt das Projekt wortlos. Die
> Differenz sind überwiegend Aggregat-Projekte ohne eigenen Code (`libs/domains/orders`
> als Ganzes — der Code liegt in `orders-domain` etc.). Wer die Abdeckung prüft,
> vergleicht die beiden Listen:
>
> ```bash
> diff <(pnpm exec nx show projects | tr ',' '\n' | sort) \
>      <(pnpm exec nx show projects --with-target typecheck | tr ',' '\n' | sort)
> ```

## Warum es vorher nichts geprüft hat

Build-Mode läuft über **alle** referenzierten Projekte, also auch über
`tsconfig.spec.json`. `tsconfig.base.json` setzt aber `declaration: false` und
`declarationMap: true` — und keine der 47 spec-Configs setzte `declaration` oder
`composite`. Ergebnis: zwei `TS5069` pro Projekt, **bevor eine einzige Datei
geprüft wurde**.

Weil `typecheck` auf `^typecheck` hängt, blockierte jedes gescheiterte Projekt
seine Abhängigen: 14 Projekte scheiterten direkt, 17 weitere kamen gar nicht zur
Ausführung. Dazu kamen zwei kleinere Klassen — `TS1343` (`import.meta.dirname`
unter `module: commonjs` in 32 `vite.config.ts`) und `TS5090`
(`paths`-Selbstreferenzen ohne führendes `./`).

Aufgefallen ist das nie, weil das Target nicht in der CI lief. Was in dieser Zeit
auflief:

| Befund | Umfang | PR |
| --- | --- | --- |
| Konfigurationsdefekt selbst | 52 tsconfigs, 32 vite-Configs, 5 `paths` | [#110](https://github.com/panary/panary-core/pull/110) |
| Zwei `@sinclair/typebox`-Instanzen | 96 × TS2345 in fünf Domain-Libs | [#111](https://github.com/panary/panary-core/pull/111), [ADR 0020](../adr/0020-sinclair-typebox-an-feathers-koppeln.md) |
| TS-Projekt-Referenzen ohne Solution-Setup | 5 × TS6306 | [#112](https://github.com/panary/panary-core/pull/112), [ADR 0021](../adr/0021-keine-ts-projekt-referenzen-ohne-solution-setup.md) |

## Der blinde Fleck darunter: api-edge (2026-08-14)

Die Reparatur von 2026-08-06 hat alles grün gemacht, **was ein Target hatte**.
`api-edge` hatte keins — und fiel deshalb nicht als roter Lauf auf, sondern
gar nicht. `nx run api-edge:typecheck` antwortete „Cannot find configuration for
task", die CI überging das Projekt in der affected-Zeile schweigend. Acht Tage
lang las sich „83 Projekte, 0 Fehler" wie eine Zusage über den Workspace,
während die 208 TS-Dateien der Edge-App nicht darin vorkamen.

Ursache war eine einzige fehlende Datei. Das `@nx/js/typescript`-Plugin leitet
`typecheck` aus der **`tsconfig.json`** eines Projekts ab; `apps/api-edge/` besaß
nur `tsconfig.app.json`, `tsconfig.spec.json` und `tsconfig.migrations.json`.
Kein Solution-File, kein Target, keine Meldung.

Darunter lag ein zweiter Defekt, der auch nach dem Anlegen der Datei zugeschlagen
hätte: `tsconfig.spec.json` erbte von `tsconfig.app.json` mit `rootDir: ./src`,
ihre `include` zieht aber `vitest.config.mts` aus dem Projekt-Root herein →
`TS6059`. Dieselbe Klasse wie das `TS5069` von #110: ein Konfigurationsfehler, der
zuschlägt, **bevor eine Datei geprüft wird**. Behoben an der Wurzel statt am
Symptom — `tsconfig.spec.json` erbt jetzt von der neuen `tsconfig.json`, womit
`rootDir` wie bei allen anderen Projekten der Workspace-Root ist. Das ist auch
nötig, weil die Specs `@panary/*` aus `libs/` importieren; ein auf `apps/api-edge`
verengtes `rootDir` bricht daran erneut.

Aus demselben Grund verliert `tsconfig.app.json` ihr `rootDir: ./src` (146×
`TS6059` unter `tsc --build`). **Auf die Build-Ausgabe wirkt das nicht** —
`@nx/esbuild` bestimmt die Struktur über `outputPath`/`outbase`. Nachgemessen
statt angenommen: alle 738 Artefakte unter `dist/apps/api-edge` sind vorher wie
nachher byte-identisch (`shasum -a 256`), die Ausgabe liegt in beiden Fällen unter
`apps/api-edge/src/`.

Die `include` der spec-Config kannte außerdem nur `src/**`, während
`vitest.config.mts` `{src,test,tests}/**` lädt: **25 Dateien** unter `test/` liefen
in jedem Testlauf mit, ohne je typgeprüft zu werden. Sie sind jetzt erfasst —
drei der vier gefundenen Bestandsfehler saßen genau dort.

Ausbeute: vier echte Typfehler, alle in Testdateien, alle behoben. Der
Produktivcode war bereits sauber (0 Fehler) — der blinde Fleck hat also keine
Schuld verdeckt, sondern nur nicht verhindert, dass sie entsteht.

**Die Lehre ist nicht „api-edge war kaputt", sondern:** Ein Target, das für ein
Projekt nicht existiert, ist unsichtbarer als eines, das rot ist. Ein rotes Target
meldet sich; ein fehlendes lässt die Gesamtzahl einfach kleiner aussehen, und
niemand vergleicht sie mit der Projektliste. Deshalb steht die Abdeckungsprüfung
oben — sie ist der einzige Weg, diese Klasse zu sehen.

## Warum das Gate hart ist

Der Workspace ist grün — eine Baseline wäre Maschinerie ohne Inhalt, und ein
hartes Gate ist das stärkere Versprechen. `typecheck` steht deshalb direkt in der
affected-Zeile der CI.

> **panary-cloud fährt dieselbe Absicht anders.** Dort liegen 334 vorbestehende
> Fehler in `api-cloud`; ein hartes Gate wäre an Tag eins rot. Deshalb ein
> Baseline-Gate (`scripts/typecheck-gate.mjs`): bekannter Bestand passiert, neue
> Fehler brechen ab. Beide Wege verfolgen dasselbe Ziel — dass eine Zahl nicht
> mehr still wachsen kann.

Dieselbe Frage stellte sich am 2026-08-07 für das **Format-Gate**, mit umgekehrtem
Ausgang: Dort war der Bestand mit 348 Dateien deutlich größer als hier, eine Baseline
trotzdem falsch — Formatierung ist mechanisch behebbar, eine Baseline hätte den Bestand
nur konserviert. Aufgeräumt, dann hart. Die Abgrenzung „Baseline nur, wo hinter der Zahl
echte Arbeit steckt" steht in
[ADR 0022](../adr/0022-format-gate-ohne-base.md).

## Messvorschrift

Wer die Fehlerzahl beurteilt, misst leicht falsch. Zwei Fallen, die heute je
zweimal zugeschlagen haben:

- **`--skip-nx-cache` leert den Nx-Task-Cache, nicht den Inkrementell-Zustand von
  `tsc --build`.** Vor einer belastbaren Messung die `.tsbuildinfo` löschen:
  `find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete`
- **Ein veraltetes `node_modules` merkt niemand.** Nach jedem Branch-Wechsel und
  jedem Rebase `pnpm install` fahren — sonst zählt man Fehler mit, die längst
  behoben sind.

## Wenn das Gate anschlägt

Es meldet echte Typfehler; die gehören behoben, nicht umgangen. Zwei Muster, die
im Repo bereits Schaden angerichtet haben und deshalb **keine** Lösung sind:

- **`as never` auf einem Service-Pfad oder einem Rückgabewert.** `app.service(x as never)`
  liefert `never`; jeder Folgezugriff scheitert danach zwangsläufig. Der Cast
  verlagert das Problem nicht, er erzeugt ein größeres.
- **`as typeof x` auf einer gerade eingeengten Variablen.** `typeof` greift die
  per Control-Flow eingeengte Form ab, nicht die deklarierte — das Ergebnis ist
  oft `null` oder `never`, und ganze Zweige gelten danach als unerreichbar.

Beide Muster hat panary-cloud in [#95](https://github.com/panary/panary-cloud/pull/95)
wieder ausgebaut, nachdem sie dort 57 Fehler erzeugt hatten.

Siehe auch: [TypeScript-7-Migration](typescript-7-migration.md).
Der Nx-Remote-Cache ist dokumentiert in `panary-cloud/docs/infrastructure/nx-remote-cache.md`.
