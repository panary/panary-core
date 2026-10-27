---
type: Report
title: OSV-Befund 2026-10-27 — qs per Override-Floor ^6.16.1, deepmerge ohne Fix befristet akzeptiert
description: GHSA-6pq8-jhm2-2vcw auf qs 6.16.0 machte osv-scanner auf jedem core-PR rot; qs ist Prod-Abhängigkeit des Edge-REST-Transports und ist per Override-Floor auf die karenzreife 6.16.1 gehoben. Minuten später kam GHSA-gcqx-w48m-w2h4 auf deepmerge 4.3.1 hinzu, ohne Fix-Version und nur dev-seitig im Baum, deshalb befristet bis 2026-11-27 in osv-scanner.toml.
tags: [security, supply-chain, dependencies, ci]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-27T22:15:00.000Z }
---

# OSV-Befund 2026-10-27 — qs per Override-Floor ^6.16.1, deepmerge ohne Fix befristet akzeptiert

## Auslöser

Der letzte `Security Scan` auf `main` (2026-10-27 14:17 UTC) war grün. Am reinen Markdown-PR
[#1162](https://github.com/panary/panary-core/pull/1162) meldete `osv-scanner (SCA)` um 21:43 UTC
ein neues Advisory auf qs. Umgesetzt in [#1163](https://github.com/panary/panary-core/issues/1163),
Pendant [panary-cloud#1482](https://github.com/panary/panary-cloud/issues/1482).

Beim Nachmessen nach dem qs-Bump kam ein zweites hinzu: Das deepmerge-Advisory wurde um 21:45 UTC
geändert, zwei Minuten nach dem roten Lauf. Ohne den Ignore bliebe der Check rot.

| Paket | aufgelöst | Advisory | Fix | Pfad |
| --- | --- | --- | --- | --- |
| qs | 6.16.0 | [GHSA-6pq8-jhm2-2vcw](https://osv.dev/GHSA-6pq8-jhm2-2vcw) (CVSS 6.3) | 6.16.1 | **Prod**: `co-body`/`koa-body` und `koa-qs` unter `@feathersjs/koa` |
| deepmerge | 4.3.1 | [GHSA-gcqx-w48m-w2h4](https://osv.dev/GHSA-gcqx-w48m-w2h4) (CVSS 5.3) | keiner | nur Dev: `@rollup/plugin-node-resolve`, `fork-ts-checker-webpack-plugin`, `jest-config` |

**qs:** `qs.stringify(obj, { arrayFormat: 'comma' })` wirft einen ungefangenen `TypeError`, wenn ein
Array-Element ein eigenes, nicht aufrufbares `toString` trägt. Das ist ein DoS, sobald eine
Anwendung angreiferbeeinflusste Objekte so zurückserialisiert. Am Edge ist qs der Query-Parser des
REST-Transports, also angreifererreichbar.

**deepmerge:** `mergeObject()` lässt Prototype-Poisoning des Ergebnisobjekts zu. Betroffen ist
4.2.0 bis 4.3.1, und 4.3.1 (2023-03-16) ist die neueste Version.

## Maßnahme

- `package.json` → `pnpm.overrides.qs`: `^6.16.0` → `^6.16.1`.
- `osv-scanner.toml`: Ignore `GHSA-gcqx-w48m-w2h4` mit `ignoreUntil = 2026-11-27`.

**Karenz:** qs 6.16.1 erschien am 2026-10-14 22:06 UTC und ist seit dem 2026-10-21 reif. Eine
Ausnahme in `minimumReleaseAgeExclude` war nicht nötig. 6.16.2 (2026-10-27 19:27 UTC) liegt noch in
der Karenz, die Auflösung bleibt deshalb bei 6.16.1.

**Verhaltensänderungen in qs 6.16.1:** Neben dem Fix ändert der Parser zwei Randfälle. `[]` gilt nur
noch am Key-Ende als Array-Syntax, und Punkte werden nur mit `allowDots` zu Klammern. Nach dem
Changelog sollten Feathers-Queries wie `$in[]=a`, `$in[0]=a` und `$sort[name]=1` davon nicht betroffen
sein. Das ist eine Annahme, gemessen wird sie erst im Sichttest am Edge.

## Gemessen

```bash
pnpm install --lockfile-only
git diff --numstat pnpm-lock.yaml    # 12 / 12 Zeilen: nur qs@6.16.0 → 6.16.1, Abhängigkeiten unverändert
```

| Messung | Ergebnis |
| --- | --- |
| `osv-scanner scan -L pnpm-lock.yaml` | `No issues found` (1970 Pakete) |
| Nur qs gehoben, ohne deepmerge-Ignore | 1 Befund: GHSA-gcqx-w48m-w2h4, deepmerge 4.3.1 |
| Gegenprobe mit dem Lockfile von `origin/main` | enthält GHSA-6pq8-jhm2-2vcw, qs 6.16.0 |
| `pnpm why deepmerge --prod` | leer |
| `pnpm audit --prod` | 4 Funde, alle fast-uri (vorbestehend, in osv-scanner.toml bis 2026-11-02 akzeptiert); `origin/main`: 5 inkl. qs |
| Verlinkte Version (`node_modules/.pnpm/node_modules/qs`) | 6.16.1 |

## Nicht belegt

- Dass Edge-REST-Queries mit 6.16.1 unverändert geparst werden, belegen nur die api-edge-Specs und der
  Sichttest, kein Spec deckt den Query-Parser direkt ab.
- Der Workbench-Root führt noch qs 6.16.0 im lokalen Lockfile und zieht separat nach.
- osv-scanner meldet den braces-Ignore `GHSA-vfj7-8cjw-p6xm` als ungenutzt. Die fast-uri-Ignores aus
  [#952](https://github.com/panary/panary-core/issues/952) sind laut eigener Begründung seit dem
  2026-10-26 23:05 UTC karenzfrei. Beides gehört nicht in diesen Befund.
