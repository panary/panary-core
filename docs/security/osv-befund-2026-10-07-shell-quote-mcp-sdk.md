---
type: Report
title: OSV-Befund 2026-10-07 — shell-quote, MCP-SDK, source-map-js und smol-toml auf Fix-Versionen gehoben
description: GHSA-pqg4-j6r4-53mv (shell-quote, kritisch) blockierte im pre-push-Scan jeden core-Push, dazu drei weitere Advisories mit Fix; alle vier nur dev-seitig im Baum, per package.json-Override auf die Fix-Versionen gehoben, source-map-js 1.2.2 bis zur Reife am 2026-10-07 14:08 UTC aus der Karenz genommen.
tags: [security, supply-chain, dependencies]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-07T08:30:00.000Z }
---

# OSV-Befund 2026-10-07 — shell-quote, MCP-SDK, source-map-js und smol-toml

## Auslöser

Der pre-push-Hook (`security:scan`, Schwelle `critical`) verweigerte am 2026-10-07 den Push von
[#631](https://github.com/panary/panary-core/issues/631), obwohl dessen Diff das Lockfile nicht
berührte. Ursache war ein neues kritisches Advisory gegen die aufgelöste Version. Drei weitere
Funde lagen darunter; der CI-Job `osv-scanner (SCA)` bricht bei jedem Fund ab, sie hätten den
PR also danach rot gemacht. Behoben im selben PR wie #631 (Entscheidung Michael).

| Paket | aufgelöst | Advisory | Schwere | Fix | Pfad |
| --- | --- | --- | --- | --- | --- |
| shell-quote | 1.10.0 | [GHSA-pqg4-j6r4-53mv](https://osv.dev/GHSA-pqg4-j6r4-53mv) | kritisch | 1.11.0 | nur dev: `launch-editor` unter `@nx/rspack`/`@nx/webpack` (Dev-Server) |
| @modelcontextprotocol/sdk | 1.30.0 | [GHSA-6qxp-vccf-f47h](https://osv.dev/GHSA-6qxp-vccf-f47h) | hoch | 1.31.0 | nur dev: `@angular/cli` |
| source-map-js | 1.2.1 | [GHSA-68fv-2mgg-jv7q](https://osv.dev/GHSA-68fv-2mgg-jv7q) | hoch | 1.2.2 | nur dev: Build-Werkzeuge |
| smol-toml | 1.8.0 | [GHSA-r4xh-jqrq-34v2](https://osv.dev/GHSA-r4xh-jqrq-34v2) | mittel | 1.9.0 | nur dev |

Keines der vier Pakete liegt im Edge-Image oder im POS-Bundle; alle hängen an Dev-Servern, der
Angular-CLI oder Build-Werkzeugen.

## Maßnahme

- `package.json` → `pnpm.overrides`: `shell-quote` `^1.11.0` (vorher `^1.9.0`), `smol-toml`
  `^1.9.0` (vorher `^1.7.1`), neu `source-map-js` `^1.2.2` und `@modelcontextprotocol/sdk`
  `^1.31.0`. Lockfile neu aufgelöst, `security:scan` danach: 0 Funde.
- **Karenz:** shell-quote (29.09.), MCP-SDK (28.09.) und smol-toml (22.09.) sind älter als die
  7 Tage aus `minimumReleaseAge`. `source-map-js@1.2.2` wurde am 2026-09-30 14:08 UTC
  veröffentlicht und wird erst am **2026-10-07 14:08 UTC** reif. Bis dahin steht es mit
  Reife-Datum unter `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.

## Erledigt

Der Karenz-Eintrag für `source-map-js` ist am 2026-10-07 nach 14:08 UTC wieder entfernt
(Nachtrag-PR zu #631). Am Workbench-Root sind die vier Floors gespiegelt
(panary/panary-workbench, Root-`pnpm-workspace.yaml`), sonst wirkten sie im Haupt-Checkout nicht.
