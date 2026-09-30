---
type: Report
title: Edge-Runtime-Image ohne npm-CLI — verwundbare Pakete am Lockfile vorbei
description: Das Base-Image node:22-bookworm-slim bringt npm 10.9.9 und corepack mit, deren eigene node_modules neun verwundbare Pakete enthielten, die weder Override-Floors noch osv-scanner erreichen; der Runtime-Stage entfernt npm, npx und corepack, und die Stücklisten-Prüfung im Edge-Build wird rot, sobald sie zurückkehren.
tags: [security, supply-chain, docker, edge]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-09-30T13:00:00.000Z }
---

# Edge-Runtime-Image ohne npm-CLI

## Auslöser

Die Stückliste `panary-edge-26.9.16.cdx.json` (Release zu panary/panary-core#443) führte
`ip-address@10.1.0` und `brace-expansion@2.0.2`, obwohl die Override-Floors beide längst
höher setzen. Die Kopien lagen nicht unter `/app`, sondern unter
`/usr/local/lib/node_modules/npm` — im npm-CLI 10.9.9, das `node:22-bookworm-slim`
mitbringt. osv.dev fand unter diesem Pfad neun betroffene Pakete (ip-address,
brace-expansion, picomatch, postcss-selector-parser, pacote 2×, sigstore, @sigstore/core).
Vollständige Liste: panary/panary-core#446.

Das Lockfile steuert nur, was `pnpm install` nach `/app/node_modules` legt. Override-Floors,
`pnpm audit` und osv-scanner sehen das Base-Image nicht.

## Maßnahme

| Stelle | Änderung |
| --- | --- |
| `tools/docker/Dockerfile.edge`, Runtime-Stage | `rm -rf` von `/usr/local/lib/node_modules/{npm,corepack}` und `/usr/local/bin/{npm,npx,corepack}`, nach dem letzten `RUN` (dem `node -e` für die Workspace-Symlinks, das nur `node` braucht) |
| `.github/workflows/build-edge-docker.yml`, „Stueckliste pruefen" | Lauf wird rot, wenn eine Komponente mit `syft:location:*` unter `/usr/local/lib/node_modules/npm/` oder `…/corepack/` liegt |

Der Runtime-Stage braucht das CLI nicht: Start per `node dist/apps/api-edge/main.js`,
Healthcheck per `curl`. Kein Code unter `apps/api-edge/src` oder `libs/` startet einen
Kindprozess, `tools/docker/` und die Compose-Dateien rufen im Container kein npm auf. Der
Build-Stage bleibt unverändert — er braucht `corepack` und `npx` und landet nicht im
Runtime-Image.

Die Sperre ist bewusst eng: Sie prüft den **Pfad**, nicht Advisories. Ein Scan der ganzen
Stückliste per osv-scanner wäre ein eigenes Gate mit eigener Pflegelast (Debian-Pakete,
Ignore-Liste) und ist nicht Teil dieser Änderung.

## Gemessen

| Messung | Ergebnis |
| --- | --- |
| Filter der Prüfung gegen die Stückliste von `v26.9.16` | 197 Treffer (196 npm, 1 corepack) — die Sperre hätte angeschlagen |
| Lokaler Image-Build (arm64, CI-Vorbereitung des Workflows nachgestellt) | Exit 0 |
| `command -v npm npx corepack` im Image | leer |
| `ls /usr/local/lib/node_modules` im Image | leer |
| Container mit `FEATHERS_SECRET` | läuft, 0 Log-Zeilen mit `level: error`; `/health` → HTTP 200 (unpaired: Setup-Modus) |

## Folgen

- `docker exec … npm` funktioniert im Edge-Container nicht mehr. Das ist gewollt.
- Die gelöschten Dateien stecken weiter in der Basis-Schicht des Images (Layer sind
  additiv). syft scannt das zusammengefasste Dateisystem und sieht sie nicht; Bytes spart
  die Änderung deshalb kaum.
- Ein neueres `node:22`-Image mit gefixtem npm ändert daran nichts — das CLI hat im
  Runtime-Image keinen Zweck.

Verwandt: [ADR 0051 — Stückliste je Release](../adr/0051-stueckliste-je-release-cyclonedx.md),
[OSV-Befund 2026-09-30](osv-befund-2026-09-30.md).
