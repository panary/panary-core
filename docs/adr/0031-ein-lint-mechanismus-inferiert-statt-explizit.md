---
type: ADR
title: Ein Lint-Mechanismus — die 46 expliziten lint-Targets entfernt statt neben dem inferierten stehenzulassen
description: Die expliziten @nx/eslint:lint-Targets in 46 project.json waren Generator-Erbe ohne Zweck und werden entfernt; gelintet wird workspace-weit über das vom @nx/eslint/plugin inferierte Target.
tags: [ci, nx, eslint, build]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-14T09:35:00.000Z }
---

# Ein Lint-Mechanismus — inferiert statt explizit

Umgesetzt mit [PR #207](https://github.com/panary/panary-core/pull/207) (`a50ab1a6`),
nachgeschärft mit [PR #209](https://github.com/panary/panary-core/pull/209). Dieses ADR
hält den Messstand fest, auf dem die Entscheidung beruht.

## Problem

Seit [#204](https://github.com/panary/panary-core/issues/204) steht `targetName` des
`@nx/eslint/plugin` auf `lint`. Das Plugin leitet damit für jedes Projekt mit
ESLint-Konfiguration ein `lint`-Target ab — 86 Stück. **46 davon trugen zusätzlich ein
explizites `lint`-Target in ihrer `project.json`**, das das inferierte überschreibt:

```json
"lint": { "executor": "@nx/eslint:lint" }
```

Alle 46 Einträge waren byte-identisch und optionslos — nachgemessen, nicht geschätzt:
`jq -c '.targets.lint'` lieferte über alle 46 Dateien denselben einen Wert. Sie stammen aus
den Nx-Generatoren, die ein `lint`-Target beim Anlegen eines Projekts unbesehen mitschreiben.

Im Repo liefen damit zwei Lint-Mechanismen nebeneinander: 46 Projekte über den
`@nx/eslint:lint`-Executor, 40 über das inferierte `nx:run-commands` mit `eslint .`. Beide
waren grün. Die Zweiteilung war kein Fehler, sondern Ballast — dieselbe Klasse wie die
projektübergreifenden `references` in [ADR 0021](0021-keine-ts-projekt-referenzen-ohne-solution-setup.md):
Generator-Erbe, das keine Funktion mehr hat, aber beim nächsten Leser wie eine bewusste
Einstellung aussieht.

Dazu kam ein toter Konfigurationsblock in `nx.json`:

```json
"@nx/eslint:lint": {
  "cache": true,
  "inputs": ["default", "{workspaceRoot}/.eslintrc.json", "{workspaceRoot}/.eslintignore", "{workspaceRoot}/eslint.config.mjs"]
}
```

`targetDefaults` greifen über den Executor-Namen. Ohne einen einzigen Nutzer des Executors ist
der Block wirkungslos — und zwei seiner vier Inputs zeigen ohnehin auf Dateien, die es im Repo
nicht gibt (`.eslintrc.json`, `.eslintignore`; der Workspace fährt Flat-Config).

## Entscheidung

Die 46 expliziten `lint`-Targets werden entfernt, zusammen mit dem `targetDefaults`-Eintrag
für `@nx/eslint:lint`. Gelintet wird ausschließlich über das inferierte Target.

Wo `targets` dadurch leer zurückblieb (23 der 46 `project.json` trugen nichts anderes), wurde
der Schlüssel ganz entfernt statt als `"targets": {}` stehenzulassen — ein leeres Objekt ist
derselbe Ballast in kleiner.

### Verlustfreiheit: gemessen, nicht angenommen

Das Ziel war nicht „CI bleibt grün" — grün war sie vorher auch. Verglichen wurde der
**Befund je Projekt**, vorher gegen nachher, aus zwei vollständigen Läufen
(`nx run-many -t lint --skip-nx-cache --output-style=stream`, dessen Zeilen-Prefix die
Zuordnung Projekt → Befund eindeutig macht):

| Messgröße | vorher | nachher |
|---|---|---|
| Projekte mit `lint`-Target | 86 | 86 (Liste identisch) |
| Executor | 46 × `@nx/eslint:lint`, 40 × `nx:run-commands` | 86 × `nx:run-commands` (`eslint .`) |
| Exit-Code `run-many -t lint` | 0 | 0 |
| Fehler / Warnungen | 0 / 882 | 0 / 882 |
| Projekte mit Befunden | 32 | 32 |
| Einzelbefunde (Datei, Zeile:Spalte, Schweregrad, Regel, Meldung) | 882 | **882, diff leer** |

Verglichen wurden die 882 Befunde einzeln, nicht ihre Summe: Zwei Läufe mit je 882 Warnungen
können unterschiedliche 882 sein. Der Diff über die normalisierte Befundliste ist leer.

> Die Befundzahl selbst war zunächst falsch gemessen. Eine erste Extraktion kam auf 878 und
> wich damit von der Summenzeile (`✖ N problems`) ab — sie verschluckte Warnungen **ohne
> Regel-ID** (`Unused eslint-disable directive …`, in `tse-gateway`). Ohne die mitgeführte
> Kontrollsumme wäre die Lücke nicht aufgefallen und der Vergleich hätte 4 Befunde
> stillschweigend ausgelassen. Jede Messung dieser Art braucht eine zweite, unabhängig
> erhobene Zahl daneben.

Gegenprobe, weil eine leere Befundliste auch heißen kann, dass nichts mehr geprüft wird: In
`shared-ui-common` — eines der 46, und aus der riskantesten Teilmenge, weil es **keine eigene**
`eslint.config.mjs` hat — wurde ein relativer Cross-Projekt-Import eingebaut.
`nx run shared-ui-common:lint` bricht mit Exit 1 und `@nx/enforce-module-boundaries` ab; nach
`git checkout --` ist der Baum wieder sauber und der Lauf grün. Der im Plan vorgesehene
Tag-Verstoß ist gar nicht herstellbar: Die `depConstraints` stehen auf
`sourceTag: '*' → onlyDependOnLibsWithTags: ['*']`.

Zusätzlich, nicht geplant: ein Diff über **alle übrigen Targets**, Tags, Roots und
Abhängigkeitskanten aller 122 Projekte aus dem Projektgraphen — identisch. Das ist die
eigentliche Absicherung dagegen, dass die textuelle Entfernung in einer der 46 Dateien etwas
anderes mitgenommen hat; der Lint-Vergleich allein hätte einen kaputten `build`-Eintrag nicht
bemerkt.

### Cache-Inputs: strenger, nicht schwächer

Das im Plan benannte Risiko war, dass mit dem `targetDefaults`-Block ein Input verlorengeht.
Die Gegenüberstellung der aufgelösten Targets aus dem Projektgraphen zeigt das Gegenteil:

| | Input | Bewertung |
|---|---|---|
| fällt weg | `{workspaceRoot}/.eslintrc.json` | Datei existiert nicht |
| fällt weg | `{workspaceRoot}/.eslintignore` | Datei existiert nicht |
| kommt hinzu | `^default` | **echter Gewinn** — Änderung in einer Abhängigkeit invalidiert jetzt |
| kommt hinzu | `externalDependencies: ["eslint"]` | **echter Gewinn** — eslint-Versionswechsel invalidiert jetzt |
| kommt hinzu | `{workspaceRoot}/<projectRoot>/eslint.config.mjs` | **redundant** — siehe unten |
| kommt hinzu | `{workspaceRoot}/tools/eslint-rules/**/*` | Ordner existiert derzeit nicht; greift, sobald es lokale Regeln gibt |

⚠️ **Die projektlokale `eslint.config.mjs` war auch vorher erfasst.** Der neue Input benennt
sie nur explizit; abgedeckt war sie längst über `default`, das in `nx.json` als
`{projectRoot}/**/*` definiert ist — und die Datei liegt im projectRoot. Am expliziten Target
nachgemessen (`libs/shared/ui-notifications`, alter Stand wiederhergestellt):

| Schritt | Ergebnis |
|---|---|
| unverändert | Cache-Treffer |
| nach Änderung an der lokalen `eslint.config.mjs` | **echter Lauf** |
| erneut, ohne Änderung | Cache-Treffer |
| nach zweiter Änderung | **echter Lauf** |

Eine Zwischenfassung der Doku hatte das Gegenteil behauptet und daraus den „belegten Schaden"
der alten Konfiguration gemacht; richtiggestellt mit [PR #209](https://github.com/panary/panary-core/pull/209).
Der Aufräumgrund bleibt unberührt — der reale Cache-Gewinn liegt bei `^default` und
`externalDependencies`, nicht bei der Datei, die man zuerst verdächtigt.

`cache: true` gilt unverändert für alle 86.

## Konsequenzen

- `nx show projects --with-target lint` liefert unverändert 86 Projekte; die CI-Zeilen in
  `.github/workflows/ci.yml` (`nx run-many -t lint`, `nx affected -t lint,test,typecheck,build`)
  bleiben, wie sie sind.
- Der Kern-Diff ist rein subtraktiv (47 Dateien, +23 gegen −216; die Hinzufügungen sind
  Klammer- und Kommaanpassungen) und per Revert vollständig rücknehmbar. Kein Laufzeitanteil,
  kein Deploy nötig.
- **Neu generierte Projekte bringen wieder ein explizites `lint`-Target mit.** Die
  Nx-Generatoren schreiben es unbesehen, genau wie die `references` in ADR 0021. Es gehört
  beim Anlegen entfernt — der Hinweis dazu steht in
  [Lib-Vitest-Test-Target](../guides/lib-vitest-test-target.md). Ein Gate dagegen existiert
  nicht; die Drift ist still und fällt nur auf, wenn jemand die `project.json` liest.
- **Der Haupt-Checkout misst das nicht mehr.** Dort liefert `nx show projects --with-target lint`
  seit dieser Änderung `0` statt `86` — sein Nx-Plugin-Cache hält einen Target-Namen von vor
  #204 (`eslint:lint`) und leitet deshalb nichts ab. Der Zustand ist älter als diese Änderung,
  war aber unsichtbar, solange 46 Projekte ihr Target explizit in der `project.json` trugen.
  Task-Messungen gehören deshalb in einen frischen Worktree; im Haupt-Checkout hilft
  `pnpm nx reset` — nie, während in einem anderen Worktree ein nx-Lauf aktiv ist.
- Die Umstellung repariert **kein** Gate und schließt keine Lücke: Beide Mechanismen fanden
  dieselben Befunde. Was sie beseitigt, ist die Frage „warum steht das hier?" beim nächsten
  Leser — und einen `targetDefaults`-Block, der wie eine aktive Einstellung aussah.
