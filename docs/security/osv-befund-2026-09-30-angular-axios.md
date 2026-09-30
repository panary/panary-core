---
type: Report
title: OSV-Befund 2026-09-30 (Nachmittag) — @angular/* auf 21.2.24, Floors axios ^1.20.0 und serialize-javascript ^7.1.2
description: Am 2026-09-30 zwischen 15:01 und 15:41 UTC erschienen Advisories auf @angular/router, axios und serialize-javascript; osv-scanner wurde auf jedem core-PR rot; geschlossen ist er durch den Angular-Lockstep mit panary-cloud auf 21.2.24 und die Override-Floors axios ^1.20.0 und serialize-javascript ^7.1.2, alle Fixes karenzreif.
tags: [security, supply-chain, dependencies, angular]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-09-30T21:30:00.000Z }
---

# OSV-Befund 2026-09-30 (Nachmittag) — @angular/* auf 21.2.24, Floors axios ^1.20.0 und serialize-javascript ^7.1.2

## Auslöser

`osv-scanner (SCA)` stand am 2026-09-30 an
[panary/panary-core#453](https://github.com/panary/panary-core/pull/453) rot, obwohl der PR
kein Lockfile berührt. Die Advisories erschienen **nach** der Vormittagsrunde
([Befund 2026-09-30](osv-befund-2026-09-30.md)). Umgesetzt in
[#451](https://github.com/panary/panary-core/issues/451). Gegenstück in cloud:
panary/panary-cloud#776 (PR panary/panary-cloud#782).

| Paket | aufgelöst | Advisories | Fix | Pfad |
| --- | --- | --- | --- | --- |
| @angular/router | 21.2.23 | GHSA-ff3f-86qr-9cv3 (high) | 21.2.24 | Produktion (POS-, Admin-, Setup-Client) |
| axios | 1.18.0 | zwölf GHSA, sieben high | 1.20.0 | nur dev (`apps/api-edge/test/*`, nx) |
| serialize-javascript | 7.1.1 | GHSA-gfhx-hw2g-v5hg (low) | 7.1.2 | nur Build-Tooling |

Die axios-Advisories: GHSA-542g-h47m-68v8, GHSA-3pq3-5fj3-cg6v, GHSA-x97p-jq2g-jp4f,
GHSA-mghh-pgcx-3jjj, GHSA-c29m-xwm3-cm6r, GHSA-r4gj-5m52-g5wh, GHSA-m8m8-qj5v-23w3 (high)
sowie GHSA-9fr6-4gfg-395g, GHSA-vh66-26gq-q6x8, GHSA-44g4-m2mj-wpvx, GHSA-4hqw-qxg8-jxx2,
GHSA-j8rh-479h-cp32 (medium).

## Maßnahme

`package.json`:

| Eintrag | vorher | nachher |
| --- | --- | --- |
| neun `@angular/*`-Framework-Pakete inkl. `animations` | `21.2.23` | `21.2.24` |
| devDependency `axios` | `^1.18.0` | `^1.20.0` |
| `pnpm.overrides.axios` | `^1.18.0` | `^1.20.0` |
| `pnpm.overrides.serialize-javascript` | `^7.0.5` | `^7.1.2` |

Angular steht damit wieder im Lockstep mit panary-cloud (dort seit #782 auf 21.2.24); sonst
hielte der Workbench-Store zwei `@angular/core`-Instanzen. Tooling (`@angular/build`, `cli`)
stand schon auf 21.2.24, `cdk`/`material` bleiben auf 21.2.14.

serialize-javascript betrifft nur 7.1.1 (`introduced 7.1.1, fixed 7.1.2`); cloud löst 7.0.5
auf und ist nicht betroffen, sein Floor bleibt deshalb `^7.0.5`.

**Karenz:** 21.2.24 erschien am 2026-09-23 17:48 UTC, axios 1.20.0 am 2026-08-26,
serialize-javascript 7.1.2 am 2026-09-23 15:52 UTC. Alle drei sind reif, eine Ausnahme in
`minimumReleaseAgeExclude` war nicht nötig. 21.2.25 (2026-09-30) bleibt draußen.

## Gemessen

```bash
pnpm install --no-frozen-lockfile
git diff --numstat pnpm-lock.yaml       # 127 / 127 Zeilen, Paketmenge unverändert
grep -cE '@angular/[a-z-]+@21\.2\.23' pnpm-lock.yaml   # 0, keine Doppelinstanz
```

| Messung | Ergebnis |
| --- | --- |
| `osv-scanner scan -L pnpm-lock.yaml` | `No issues found` (2011 Pakete) |
| Gegenprobe: CI-Lauf an #453 mit dem Lockfile von `main` | 14 Befunde (Angular 1, axios 12, serialize-javascript 1) |
| `pnpm audit --audit-level=moderate --prod` | `No known vulnerabilities found` |
| Verlinkte Versionen (`require('…/package.json')`) | axios 1.20.0, @angular/router 21.2.24 |

## Nicht belegt

Dass die POS-, Admin- und Setup-Clients mit 21.2.24 unverändert laufen, belegen nur Build
und Unit-Specs; ein Patch-Release ohne API-Änderung, aber nicht im Browser geprüft. Der
Workbench-Root muss nach dem Merge per Lockfile-Sequenz nachgezogen werden, sonst liegen dort
weiter 21.2.23-Instanzen.
