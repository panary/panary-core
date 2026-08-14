---
type: Guide
title: Die vier Target-Gates — wogegen sie stehen und was sie nicht sehen
description: Übersicht der Nx-Target-Gates in der CI (Leerstand, Überschreibung, Caching) samt der Fehlerklasse dahinter — ein Target, das nicht das tut, was sein Name verspricht, meldet grün.
tags: [ci, infra, nx, gates]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-14T13:10:00Z }
---

# Die vier Target-Gates

Zwischen dem 2026-08-06 und dem 2026-08-14 sind in dieser Codebasis fünf Befunde
aufgelaufen, die **dieselbe Form** haben: Ein Nx-Target tut nicht das, was sein
Name verspricht — und die CI meldet grün, weil nichts *fehlschlägt*, nur etwas
*nicht stattfindet*.

| Befund | Was war | Wie es aussah |
| --- | --- | --- |
| [#110/#111](https://github.com/panary/panary-core/pull/110) | `typecheck` starb an TS5069, bevor eine Datei geprüft wurde | grün |
| [#202](https://github.com/panary/panary-core/issues/202) | `api-edge` hatte gar kein `typecheck`-Target | grün, und 83 statt 84 Projekte |
| [#204](https://github.com/panary/panary-core/issues/204) | Lint-Target hieß `eslint:lint`, die CI rief `lint` | grün, 40 Projekte ungelintet |
| [#213](https://github.com/panary/panary-core/issues/213) | zwei `test`-Targets ohne Caching | grün, nur langsamer |
| [#216](https://github.com/panary/panary-core/issues/216) | 52 `build`-Targets ohne Caching | grün, nur langsamer |

Keiner dieser Fälle war ein Fehler im Code. Alle fünf waren Konfiguration, die
**etwas anderes tat als angenommen**, und keiner hätte sich von selbst gemeldet.
Dagegen stehen heute vier Gates:

| Gate | Skript | Baseline? | Fängt |
| --- | --- | --- | --- |
| Leerstand | `empty-targets:gate` | ja (45) | `test`-Target ohne eine einzige Spec |
| Überschreibung | `targets:overrides:gate` | nein | explizites Target, das eine Plugin-Inferenz verdrängt |
| Caching | `targets:uncached:gate` | ja (36) | Target mit `outputs`, das nicht cachebar ist |
| Typecheck | in `nx affected` | nein | echte Typfehler, auch in Specs |

Alle drei Skript-Gates haben **einen eigenen Spec, der in der CI davor läuft**.
Das ist keine Zeremonie: Beim Bau des Überschreibungs-Gates fand sein Spec, dass
`@nx/vitest` seine Optionen `testTargetName`/`ciTargetName` mit großem T schreibt
— das erste Muster prüfte `/targetName$/` und hätte `test-ci` still nie bewacht.
Der Lauf gegen den echten Bestand war grün und hätte es nicht gezeigt. Ein Gate,
dessen Test nie läuft, ist derselbe Fall, den es verhindern soll.

## Baseline oder hart?

Die Regel dahinter steht in [ADR 0022](../adr/0022-format-gate-ohne-base.md):
**Eine Baseline lohnt nur, wo hinter der Zahl echte Arbeit steckt.** Ist der
Bestand 0 oder mechanisch behebbar, wird aufgeräumt und das Gate hart gesetzt —
das ist das stärkere Versprechen.

- `typecheck` und `targets:overrides` sind hart, weil ihr Bestand 0 ist.
- `empty-targets` und `targets:uncached` tragen eine Baseline, weil dort 45 bzw.
  36 bewusst akzeptierte Fälle liegen, die sich nicht wegräumen lassen.

Beide Baselines sind **Listen, keine Zähler**. Ein Zähler ist blind dagegen, dass
A verschwindet (-1) und B neu dazukommt (+1) — netto unverändert, und niemand
sieht es.

## Was die Gates nicht sehen

Diese Liste ist der wichtigere Teil der Seite. Wer sie überspringt, überschätzt
die Abdeckung:

- **`build` bleibt vom Überschreibungs-Gate ungeprüft.** 98 explizite
  `build`-Targets sind legitim (rollup, ng-packagr, esbuild bauen Pakete, die
  `tsc --emitDeclarationOnly` nicht erzeugt), viele davon mit generischem
  `nx:run-commands`. Eine Executor-Allowlist könnte dort nichts unterscheiden.
  Das Gate druckt diese Lücke bei jedem Lauf mit aus.
- **Ob `outputs` vollständig sind, misst niemand.** Ein Target, das mehr
  schreibt, als es deklariert, cacht falsch und stellt bei einem Treffer ein
  unvollständiges `dist/` wieder her — die gefährlichere Klasse. Gegenprobe ist
  manuell: `dist/` löschen, Task laufen lassen, Artefakte vergleichen.
- **Die Gates prüfen Deklarationen, nicht Wirkung.** Ein Target, das über
  `targetDefaults`, ein eigenes Plugin oder `package.json#nx` gesetzt wird,
  fällt durch alle drei.
- **Ausnahme-Listen schrumpfen die Abdeckung still.** `UNGESCHUETZT`,
  `ERLAUBTE_EXECUTOREN` und die beiden Baselines sind Ermessensentscheidungen;
  jede hat deshalb einen Spec-Fall, der ihren Inhalt festnagelt.

## Abdeckung selbst nachmessen

Keiner Zahl aus dieser Seite trauen, ohne sie nachzurechnen — sie altert:

```bash
# Welche Projekte haben ein Target gar nicht?
diff <(pnpm exec nx show projects | tr ',' '\n' | sort) \
     <(pnpm exec nx show projects --with-target typecheck | tr ',' '\n' | sort)

# Was melden die Gates gerade?
pnpm empty-targets:gate && pnpm targets:overrides:gate && pnpm targets:uncached:gate
```

Siehe auch: [Nx-Typecheck-Target](nx-typecheck-target.md) für die Vorgeschichte
und die Messvorschrift.
