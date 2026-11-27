---
type: Report
title: OSV-Befund 2026-11-27 — glob- und minimatch-Ausnahme bis 2027-01-08 verlängert
description: Die Ausnahmen GHSA-3g3m-2fjr-6pw4 (glob) und GHSA-g3hv-75wg-m249 (minimatch) liefen am 2026-11-27 ab. Beide Fixes liegen weiter nur in Major-Versionen, die die Dev-Konsumenten (mocha, test-exclude, jest-Pakete, nx 23) nicht ziehen. Neu ist, dass nx 24 minimatch 11 nutzt, der nx-Teil hängt damit am Major-Update. Frist bis 2027-01-08 verlängert, Begründung erneuert.
tags: [security, supply-chain, dependencies]
status: stable
stale_after: 2027-01-08
generated: { by: claude-code/opus-5.5, at: 2026-11-27T12:00:00.000Z }
---

# OSV-Befund 2026-11-27 — glob- und minimatch-Ausnahme verlängert

## Auslöser

Beide Einträge in `osv-scanner.toml` trugen `ignoreUntil = 2026-11-27`. Ab dem Folgetag hätte `osv-scanner (SCA)` jeden
PR rot gemeldet. Vorgeschichte: [OSV-Befund 2026-11-09](osv-befund-2026-11-09-minimatch-11-blockiert.md).
Pendant in panary-cloud mit derselben Frist; dort ist zusätzlich die Astro-Adapter-Ausnahme entfallen.

## Messung (2026-11-27, `pnpm-lock.yaml` auf `origin/main`)

| Paket | Version | Konsumenten (alle Dev) |
| --- | --- | --- |
| glob | 10.5.0 | mocha 11.8.0, test-exclude 7.0.2 |
| glob | 13.0.7 | @jest/reporters, jest-config, jest-runtime 30.5.2 (unter @nx/jest) |
| glob | 14.0.6 | rimraf 6.1.4 (nicht betroffen) |
| minimatch | 9.0.9 | glob 10.5.0, mocha |
| minimatch | 10.2.5 | nx, @nx/devkit, @nx/jest 23.3.1 |
| minimatch | 10.2.6 | glob 13.0.7, test-exclude 7.0.2, nodemon 3.1.14, @typescript-eslint/typescript-estree 8.71.1 und 8.72.1 |

`pnpm why glob --prod` und `pnpm why minimatch --prod` sind leer, im Edge-Image liegt keiner der Pfade.

## Was sich upstream bewegt hat

- nx 24.0.7 (2026-11-25) und 24.1.0 (2026-11-27) ziehen minimatch 11.0.8. Der nx-Teil ist damit lösbar, aber nur über das
  Major-Update nx 23 → 24 in beiden Repos (eigenes Issue). `@nx/angular` 24.1.0 akzeptiert Angular 20 bis 22, ein Angular-Sprung ist dafür nicht nötig. Die Karenz endet am 2026-12-02 bzw. 2026-12-04.
- `@typescript-eslint/typescript-estree` 8.74 verlangt `minimatch ^11.0.1`.
- Weiter blockierend: mocha 12.0.3 und test-exclude 8.0.0 hängen an glob 13 bzw. `minimatch ^10.2.2`, die neueste
  Fassung `@jest/reporters` 30.5.2 zieht glob 13. Der glob-Fix liegt nur in Major 14 (aktuell 14.0.6).

Ein Override über Major-Grenzen scheidet weiter aus: minimatch 11 entfernt `makeRe` und füllt `Minimatch#set` mit
Matcher-Objekten, glob 14 ändert die API seiner Konsumenten. Die Muster stammen aus der eigenen Test- und
Build-Konfiguration, nie aus fremdem Input.

## Entscheidung

Frist beider Einträge bis 2027-01-08 verlängert, Begründung mit den Zahlen oben erneuert. Sechs Wochen reichen für das
nx-24-Update in beiden Repos und eine erneute Messung von mocha, test-exclude und jest. Entfernt werden die
Einträge, sobald nx minimatch >= 11.0.1 zieht und kein Konsument mehr glob < 14 auflöst.

## Messung nach der Änderung

`osv-scanner scan source --lockfile pnpm-lock.yaml --config osv-scanner.toml`: keine Treffer, 5 gefilterte Befunde (glob und minimatch über mehrere Versionen), keine „unused ignores“.
