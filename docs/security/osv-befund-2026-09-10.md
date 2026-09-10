---
type: Report
title: OSV-Befund 2026-09-10 — js-yaml, svgo, smol-toml per Override-Floor, adm-zip ohne Fix befristet akzeptiert
description: Fünf Advisories (js-yaml, svgo 2×, smol-toml, adm-zip) ließen den nächtlichen OSV-Scan ab dem 2026-09-09 rot werden; drei Pakete sind über Override-Floors geschlossen, für adm-zip gibt es keinen Fix und der Befund ist bis 2026-12-10 als akzeptiertes Risiko dokumentiert (dev-only, Module Federation ungenutzt).
tags: [security, supply-chain, dependencies, ci]
status: stable
generated: { by: claude-code/fable-5.1, at: 2026-09-10T10:00:00.000Z }
---

# OSV-Befund 2026-09-10 — js-yaml, svgo, smol-toml per Override-Floor, adm-zip ohne Fix befristet akzeptiert

## Auslöser

Der nächtliche `osv-scanner` lief am 2026-09-08 grün und ab dem **2026-09-09**
rot, bei unverändertem `main` (`fc2ee394`). Vier Pakete, fünf Advisories:

| Advisory | Paket | Betroffen | Fix | CVSS |
| --- | --- | --- | --- | --- |
| [GHSA-2883-xcg3-v3hh](https://osv.dev/GHSA-2883-xcg3-v3hh) | js-yaml | 4.3.1 | 4.3.2 | 7.5 |
| [GHSA-w27v-7q3p-w38r](https://osv.dev/GHSA-w27v-7q3p-w38r) | svgo | 4.0.2 | 4.1.0 | 8.2 |
| [GHSA-4vpr-x523-8j87](https://osv.dev/GHSA-4vpr-x523-8j87) | svgo | 4.0.2 | 4.1.0 | 6.1 |
| [GHSA-7w5x-hrqm-74c2](https://osv.dev/GHSA-7w5x-hrqm-74c2) | smol-toml | 1.6.1 | 1.7.1 | 8.2 |
| [GHSA-vwc7-r8mq-g2x9](https://osv.dev/GHSA-vwc7-r8mq-g2x9) | adm-zip | 0.6.0 | **keiner** | 6.8 |

js-yaml: `maxTotalMergeKeys` begrenzt die CPU-Zeit bei Merge-Keys nicht (Nachzügler
zum Fix vom 2026-08-07). svgo: `removeScripts` lässt ausführbare Links und
Event-Handler durch. smol-toml: DoS über fehlgeformtes TOML. adm-zip: Beim
Entpacken folgt `writeFileTo` einem am Ziel bereits liegenden Symlink nach außen.

panary-cloud traf dieselbe Welle plus zehn weitere Advisories (astro, sharp, hono,
nodemailer, vitest) — siehe das cloud-Pendant dieses Befunds.

## Herkunft

Gemessen im committeten `pnpm-lock.yaml`:

- **js-yaml** 4.3.1 über `@eslint/eslintrc`, `cosmiconfig`, `@istanbuljs/load-nyc-config` — Tooling.
- **svgo** 4.0.2 über `postcss-svgo` (cssnano im Angular-Build) — Build-Zeit.
- **smol-toml** 1.6.1 über `nx` — Tooling.
- **adm-zip** 0.6.0 über `@nx/angular > @nx/module-federation > @module-federation/dts-plugin` — dev-only.

Nichts davon ist ein direkter Import; nichts davon liegt in einem Laufzeit-Image.

## Entscheidung

| Paket | Maßnahme | Fix publiziert | reif seit |
| --- | --- | --- | --- |
| js-yaml | Override `^4.3.1` → `^4.3.2` | 2026-08-26 | 2026-09-02 |
| svgo | Override neu `^4.1.0` | 2026-08-24 | 2026-08-31 |
| smol-toml | Override neu `^1.7.1` (löst 1.8.0, 2026-08-11) | 2026-07-26 | längst |
| adm-zip | **Ignore bis 2026-12-10** in `osv-scanner.toml` | — | — |

**adm-zip ist der Sonderfall — Weg 1 (Ignore) aus der Karenz-Doku, weil es keine
unbetroffene Version gibt:** Die Advisory nennt `0.5.9` bis `0.6.0` als betroffen,
und 0.6.0 ist die neueste veröffentlichte Version (npm `latest`, 2026-07-10). Ein
Versionssprung bringt nichts, ein Override auch nicht.

Angriffsvorbedingung: ein angreifergeliefertes Archiv, entpackt in ein Ziel, in dem
bereits ein Symlink nach außen liegt. `@module-federation/dts-plugin` entpackt
Remote-Typ-Archive ausschließlich während eines Module-Federation-Builds. Im Repo
gemessen am 2026-09-10: **0 Vorkommen** von `module-federation`,
`ModuleFederation` oder `withModuleFederation` in `apps/` und `libs/` (`.ts`,
`.json`, `.mjs`, `.js`). Auf dem geprüften Aufrufpfad ist der Entpacker damit
nicht erreichbar; eine darüber hinausgehende Aussage zur Ausnutzbarkeit ist
nicht belegt.

Re-Evaluation spätestens am 2026-12-10, früher bei einem adm-zip-Fix (dann
Override-Floor statt Ignore) oder sobald Module Federation eingeführt wird.

## Verifikation

Im Worktree (**nicht** unterhalb von `.claude/`):

```bash
grep -oE "^  '?(js-yaml|svgo|smol-toml|adm-zip)@[0-9.]+" pnpm-lock.yaml | sort -u
# Erwartung: js-yaml@4.3.2, svgo@4.1.0, smol-toml@1.8.0, adm-zip@0.6.0 (bewusst)

osv-scanner scan --config osv-scanner.toml -L pnpm-lock.yaml
# Erwartung: "GHSA-vwc7-r8mq-g2x9 … filtered out" + "No issues found"
```

Den nächtlichen Lauf nach dem Merge einmal abwarten.
