---
type: Report
title: OSV-Befund 2026-11-09 — minimatch 11 als Override ausgeschlossen, follow-redirects-Ignore entfernt
description: Der Fix zu GHSA-g3hv-75wg-m249 liegt nur in minimatch 11, und Version 11 entfernt makeRe und füllt Minimatch#set mit Matcher-Objekten statt RegExp; nx 23.3.1 und glob 10/13 bauen darauf, ein Override hätte nx abstürzen und glob still falsch auflösen lassen. Der Ignore bleibt bis 2026-11-27 mit erneuerter Begründung; der abgelaufene follow-redirects-Ignore ist entfernt.
tags: [security, supply-chain, dependencies]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-09T14:30:00.000Z }
---

# OSV-Befund 2026-11-09 — minimatch 11 als Override ausgeschlossen, follow-redirects-Ignore entfernt

## Auslöser

Seit [#1230](https://github.com/panary/panary-core/issues/1230) steht
[GHSA-g3hv-75wg-m249](https://osv.dev/GHSA-g3hv-75wg-m249) (minimatch, Denial of Service über
Globparts-Verstärkung, CVSS 6.9) befristet bis 2026-11-27 in `osv-scanner.toml`. Vorgesehen war, nach der
Karenz von minimatch 11.0.1 (reif ab 2026-11-03) einen Override auf Major 11 zu versuchen.

Am 2026-11-05 zog GitHub den Dependabot-Alert #347 zurück und legte ihn als #348 mit eingegrenzter Range neu
an: `>= 7.0.0, < 11.0.1`. Damit liegen 3.1.5 und 5.1.9 außerhalb.

| aufgelöst | Konsumenten (Lockfile `main` @ `50abe2ea`) |
| --- | --- |
| 9.0.9 | glob 10.5.0, mocha 11.8.0 |
| 10.2.5 | nx 23.3.1, @nx/devkit, @nx/jest |
| 10.2.6 | glob 13.0.6, test-exclude 7.0.2, nodemon 3.1.14, @typescript-eslint/typescript-estree 8.72.1 |

Es gibt keine Backports auf 9.x oder 10.x, die letzte 10er-Version ist 10.2.6.

## Warum kein Override

minimatch 11 ist keine Major-Version, die nur Node-Versionen streicht. Gegen 11.0.4 gemessen:

```text
typeof minimatch.makeRe: undefined | typeof export makeRe: undefined
typeof Minimatch#makeRe: undefined
set-Element *.spec.ts: Matcher instanceof RegExp: false
```

Davon betroffen sind zwei Konsumenten:

- **nx 23.3.1** ruft `minimatch.makeRe(...)` auf, in `utils/find-matching-projects.js` (Projektmuster
  bei `-p`/`--projects`), `generators/utils/glob.js` und `command-line/release/utils/repository-git-tags.js`.
  Das endet mit einem `TypeError`.
- **glob 10.5.0 und 13.0.6** unterscheiden die Teile von `Minimatch#set` per `instanceof RegExp`
  (`processor.js`, `pattern.js`). Ein `Matcher` ist weder String noch RegExp, und glob löst Muster dann
  **still** falsch auf. vitest, jest und mocha fänden weniger Specs, die Gates würden grün, weil sie weniger messen.

Ein Teil-Override nur für die übrigen Konsumenten (`mocha>minimatch` usw.) schlösse den Alert nicht, weil nx
und glob auf 9.x/10.x blieben.

## Upstream-Stand 2026-11-09

| Paket | neueste Version | zieht |
| --- | --- | --- |
| nx | 24.0.5 (auch `next` 24.0.0-rc.1) | minimatch **10.2.5** exakt |
| glob | 14.0.4 | minimatch ^11.0.5 |
| test-exclude | 8.0.0 | minimatch ^10.2.2, glob ^13.0.6 |
| mocha | 12.0.3 | minimatch ^10.2.2, glob ^13.0.0 |
| @jest/reporters | 30.5.2 | glob ^13.0.6 |
| nodemon | 3.1.14 | minimatch ^10.2.1 |
| @typescript-eslint/typescript-estree | 8.72.1 | minimatch ^10.2.2 |

Nur glob 14 ist schon auf minimatch 11.

## Entscheidung

- Der minimatch-Ignore bleibt bis **2026-11-27**, mit erneuerter Begründung, die die betroffenen Versionen,
  die API-Brüche und die Entfernungsbedingung nennt: nx zieht minimatch >= 11.0.1, und kein Konsument löst
  mehr glob < 14 auf. Die Frist ist nicht verlängert, das entscheidet Michael vor dem 2026-11-27.
- Nur Dev-Abhängigkeit (`pnpm why minimatch --prod` ist leer), nicht im Edge-Image. Die Muster stammen aus der
  eigenen Werkzeug-Konfiguration, nie aus fremdem Input.
- **follow-redirects** (GHSA-mrwp-f3q8-3g9p): Der Ignore war mit `ignoreUntil = 2026-11-03` abgelaufen. Der
  Override-Floor `^1.16.2` aus [#1265](https://github.com/panary/panary-core/pull/1265) wirkt, das Lockfile
  löst nur noch 1.16.2 auf. Der Eintrag ist entfernt.

Pendant: `panary-cloud/osv-scanner.toml` ist synchron zu halten.
