---
type: ADR
title: Ein Lint-Mechanismus — die 46 expliziten lint-Targets entfernt statt neben dem inferierten stehenzulassen
description: Die expliziten @nx/eslint:lint-Targets in 46 project.json waren Generator-Erbe ohne Zweck und werden entfernt; gelintet wird workspace-weit über das vom @nx/eslint/plugin inferierte Target.
tags: [ci, nx, eslint, build]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-14T08:59:55.000Z }
---

# Ein Lint-Mechanismus — inferiert statt explizit

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

Gegenprobe, weil eine leere Befundliste auch heißen kann, dass nichts mehr geprüft wird: In
`shared-ui-common` — eines der 46, und aus der riskantesten Teilmenge, weil es **keine eigene**
`eslint.config.mjs` hat — wurde ein relativer Cross-Projekt-Import eingebaut.
`nx run shared-ui-common:lint` bricht mit Exit 1 und `@nx/enforce-module-boundaries` ab; nach
`git checkout --` ist der Baum wieder sauber und der Lauf grün.

### Cache-Inputs: strenger, nicht schwächer

Das im Plan benannte Risiko war, dass mit dem `targetDefaults`-Block ein Input verlorengeht.
Die Gegenüberstellung der aufgelösten Targets aus dem Projektgraphen zeigt das Gegenteil:

| | Input | Bewertung |
|---|---|---|
| fällt weg | `{workspaceRoot}/.eslintrc.json` | Datei existiert nicht |
| fällt weg | `{workspaceRoot}/.eslintignore` | Datei existiert nicht |
| kommt hinzu | `^default` | Änderung in einer Abhängigkeit invalidiert jetzt |
| kommt hinzu | `{workspaceRoot}/<projectRoot>/eslint.config.mjs` | projekteigene Config (71 der 86 haben eine) |
| kommt hinzu | `{workspaceRoot}/tools/eslint-rules/**/*` | Ordner existiert derzeit nicht; greift, sobald es lokale Regeln gibt |
| kommt hinzu | `externalDependencies: ["eslint"]` | eslint-Versionswechsel invalidiert jetzt |

Die 46 Projekte cachten bisher über Änderungen an ihren Abhängigkeiten **hinweg** — ein
Zustand, in dem ein Cache-Treffer eine veraltete Aussage sein kann. `cache: true` gilt
unverändert für alle 86.

## Konsequenzen

- `nx show projects --with-target lint` liefert unverändert 86 Projekte; die CI-Zeilen in
  `.github/workflows/ci.yml` (`nx run-many -t lint`, `nx affected -t lint,test,typecheck,build`)
  bleiben, wie sie sind.
- Der Diff ist rein subtraktiv (47 Dateien, 23 Zeilen hinzu gegen 207 entfernt — die
  Hinzufügungen sind Klammer- und Kommaanpassungen) und per Revert vollständig rücknehmbar.
  Kein Laufzeitanteil.
- **Neu generierte Projekte bringen wieder ein explizites `lint`-Target mit.** Die
  Nx-Generatoren schreiben es unbesehen, genau wie die `references` in ADR 0021. Es gehört
  beim Anlegen entfernt. Ein Gate dagegen existiert nicht — die Drift ist still und fällt nur
  auf, wenn jemand die `project.json` liest.
- Die Umstellung repariert **kein** Gate und schließt keine Lücke: Beide Mechanismen fanden
  dieselben Befunde. Was sie beseitigt, ist die Frage „warum steht das hier?" beim nächsten
  Leser — und einen `targetDefaults`-Block, der wie eine aktive Einstellung aussah.
