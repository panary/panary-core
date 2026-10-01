---
type: Report
title: OSV-Befund 2026-10-01 — piscina per Override-Floor ^5.3.2
description: GHSA-67c8-pqhq-4rmx (critical, Prototype-Pollution-Gadget in den ThreadPool-Optionen bis zur Codeausführung) traf piscina 5.2.0, das nur noch ng-packagr auflöste; der Override-Floor ^5.3.2 schließt den Befund ohne weitere Resolutionsänderung, der Fix ist karenzreif.
tags: [security, supply-chain, dependencies]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-01T20:40:00.000Z }
---

# OSV-Befund 2026-10-01 — piscina per Override-Floor ^5.3.2

## Auslöser

In panary-cloud blockierte GHSA-67c8-pqhq-4rmx jeden Push am `security-scan`-Hook
(panary/panary-cloud#812). Dasselbe Paket stand im core-Lockfile. Umgesetzt in
[#469](https://github.com/panary/panary-core/issues/469).

| Paket | aufgelöst | Advisory | Fix | Pfad |
| --- | --- | --- | --- | --- |
| piscina | 5.2.0 | GHSA-67c8-pqhq-4rmx (critical, CVSS 9.2) | 5.3.2 | nur Build-Tooling (`ng-packagr` 21.2.5) |

Das Advisory beschreibt ein Prototype-Pollution-Gadget in `ThreadPool.options`: Ist
`Object.prototype` verschmutzt, übernimmt der Pool `execArgv`, `loadBalancer` oder `env` und
führt damit Code aus. piscina läuft nur in Build-Prozessen, nicht im Edge-Image und nicht in
den ausgelieferten Clients.

`@angular/build` 21.2.24 löste bereits 5.3.2 auf; 5.2.0 hing allein an `ng-packagr`. Die
Issue-Annahme, die Herkunft sei `@angular/build`, traf für core nicht mehr zu.

## Maßnahme

`package.json` → `pnpm.overrides.piscina`: `^5.2.0` → `^5.3.2`.

**Karenz:** 5.3.2 erschien am 2026-08-28 08:43 UTC und ist reif; eine Ausnahme in
`minimumReleaseAgeExclude` war nicht nötig.

## Gemessen

```bash
pnpm install --no-frozen-lockfile
git diff --numstat pnpm-lock.yaml    # 3 / 11 Zeilen: piscina@5.2.0 entfällt, ng-packagr zeigt auf 5.3.2
```

| Messung | Ergebnis |
| --- | --- |
| `osv-scanner scan -L pnpm-lock.yaml` | `No issues found` (2010 Pakete) |
| Gegenprobe mit dem Lockfile von `origin/main` | 1 Befund: GHSA-67c8-pqhq-4rmx, piscina 5.2.0 (2011 Pakete) |
| `pnpm audit --audit-level=moderate --prod` | `No known vulnerabilities found` |
| Verlinkte Version (`node_modules/.pnpm/node_modules/piscina`) | 5.3.2 |

## Nicht belegt

Dass `ng-packagr` mit 5.3.2 unverändert baut, belegen nur die Library-Builds der PR-Gates. Der
Workbench-Root führt denselben Floor (`pnpm-workspace.yaml`, `piscina: '^5.2.0'`) und zieht wie
bei panary/panary-workbench#133 separat nach.
