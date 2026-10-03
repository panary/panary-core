---
type: Report
title: OSV-Befund 2026-10-03 — braces und http-cache-semantics ohne Fix befristet akzeptiert
description: GHSA-vfj7-8cjw-p6xm (braces, Stack-Exhaustion-DoS) und GHSA-ch52-4w7c-c8xp (http-cache-semantics, max-stale) ließen osv-scanner auf jedem core-PR rot werden; beide ohne Fix-Version, beide nur dev-seitig im Baum und nicht im Edge-Image, deshalb befristete Ausnahmen bis 2026-11-03 in osv-scanner.toml — Pendant zu panary-cloud#912.
tags: [security, supply-chain, dependencies]
status: stable
stale_after: 2026-11-03
generated: { by: claude-code/opus-5.5, at: 2026-10-03T08:20:00.000Z }
---

# OSV-Befund 2026-10-03 — braces und http-cache-semantics ohne Fix befristet akzeptiert

## Auslöser

`osv-scanner (SCA)` wurde auf jedem core-PR rot, zuerst gesehen an
[PR #498](https://github.com/panary/panary-core/pull/498), dessen Diff kein Lockfile
berührt. Der letzte grüne Lauf war PR #495 am 2026-10-02T20:28Z. Beide Advisories wurden
im September 2026 veröffentlicht und erfassen jeweils die neueste Version
([#499](https://github.com/panary/panary-core/issues/499), Pendant
[panary/panary-cloud#912](https://github.com/panary/panary-cloud/issues/912)).

| Paket | aufgelöst | Advisory | betroffen | Fix | Pfad |
| --- | --- | --- | --- | --- | --- |
| braces | 3.0.3 | [GHSA-vfj7-8cjw-p6xm](https://osv.dev/GHSA-vfj7-8cjw-p6xm) (8.7) | `<= 3.0.3` | keiner | nur dev: `chokidar`/`micromatch` unter `@nx/rspack`, `@nx/webpack`, `nodemon`, `shelljs` |
| http-cache-semantics | 4.2.0 | [GHSA-ch52-4w7c-c8xp](https://osv.dev/GHSA-ch52-4w7c-c8xp) (8.7) | `<= 4.2.0` | keiner | nur dev: `make-fetch-happen` unter `pacote`, `@sigstore/sign`, `tuf-js` |

## Warum der Angriffsweg hier nicht vorkommt

- **braces:** Das DoS braucht ein vom Angreifer geliefertes, tief verschachteltes
  Klammer-Muster. Die Muster kommen hier aus der eigenen Werkzeug-Konfiguration:
  Watch-Pfade von nodemon und den Dev-Servern sowie Globs der Build-Werkzeuge. Kein Code in
  `apps/` oder `libs/` importiert braces oder micromatch.
- **http-cache-semantics:** Das Advisory setzt einen HTTP-Cache voraus, den mehrere Nutzer
  teilen. `make-fetch-happen` cacht beim Paketabruf der Angular-CLI und von Sigstore lokal
  für einen einzigen Nutzer.

## Maßnahme

`osv-scanner.toml`: je ein `[[IgnoredVulns]]` mit `ignoreUntil = 2026-11-03`. Läuft die
Frist ab, wird osv-scanner wieder rot und erzwingt die Neubewertung. Die Einträge gelten
laut Dateikopf auch für `tools/scripts/osv-edge-advisories.sh`. Dort sind sie wirkungslos,
weil keines der Pakete im Image steckt (siehe unten).

## Gemessen (`origin/main` @ `84c710e6b`)

| Messung | Ergebnis |
| --- | --- |
| `pnpm view braces version` / `pnpm view http-cache-semantics version` | `3.0.3` / `4.2.0`, je identisch mit `last_affected` in OSV |
| `pnpm why braces --prod`, `pnpm why http-cache-semantics --prod` | beide leer |
| `pnpm audit --audit-level=moderate --prod` | `No known vulnerabilities found` |
| `pnpm audit --audit-level=low` (ohne `--prod`) | meldet http-cache-semantics. Kein Gate fährt `pnpm audit` |
| Edge-Image | `scan-advisories` im Dispatch [37107902781](https://github.com/panary/panary-core/actions/runs/37107902781) auf `84c710e6b` grün, noch ohne diese Einträge |
| `osv-scanner scan source --config osv-scanner.toml -L pnpm-lock.yaml` | `Filtered 3 vulnerabilities`, `No issues found`, Exit 0 |

## Offen

Bei einer Fix-Version per Override-Floor heben und den Eintrag entfernen. panary-cloud
entscheidet in #912 eigenständig; `osv-scanner.toml` beider Repos ist laut Dateikopf
synchron zu halten.
