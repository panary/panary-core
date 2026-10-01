---
type: Report
title: OSV-Befund 2026-10-02 — node-forge ohne Fix befristet akzeptiert
description: GHSA-86w9-cpqp-85rv (RSA-PKCS#1-v1.5-Signaturprüfung, CVSS 8.7) auf node-forge 1.4.0 ließ osv-scanner auf jedem core-PR rot werden; es gibt keine Fix-Version, node-forge hängt nur dev-seitig über @nx/rspack → @rspack/dev-server → selfsigned im Baum und nicht im Edge-Image, deshalb eine befristete Ausnahme bis 2026-11-02 in osv-scanner.toml — Pendant zu panary-cloud#835.
tags: [security, supply-chain, dependencies]
status: stable
stale_after: 2026-11-02
generated: { by: claude-code/opus-5.5, at: 2026-10-02T00:40:00.000Z }
---

# OSV-Befund 2026-10-02 — node-forge ohne Fix befristet akzeptiert

## Auslöser

`osv-scanner (SCA)` wurde auf jedem core-PR rot, gesehen an
[PR #476](https://github.com/panary/panary-core/pull/476), dessen Diff kein Lockfile
berührt. Der letzte grüne `main`-Lauf (`fd44f544`) lag vor dem Advisory.
Begründung und Messung in panary-cloud:
[panary/panary-cloud#835](https://github.com/panary/panary-cloud/issues/835); dieses
Dokument hält fest, was davon in core gemessen wurde
([#475](https://github.com/panary/panary-core/issues/475)).

| Paket | aufgelöst | Advisory | betroffen | Fix | Pfad |
| --- | --- | --- | --- | --- | --- |
| node-forge | 1.4.0 | [GHSA-86w9-cpqp-85rv](https://osv.dev/GHSA-86w9-cpqp-85rv) (8.7) | `<= 1.4.0` | keiner | nur dev: `@nx/angular` → `@nx/rspack` → `@rspack/dev-server@1.2.1` → `selfsigned@2.4.1` |

## Warum keine Signatur von außen geprüft wird

`@rspack/dev-server` ruft `selfsigned.generate()` nur für einen HTTPS-Dev-Server ohne
eigenes Zertifikat. selfsigned prüft dann per `forge.pki.verifyCertificateChain` das eben
selbst erzeugte Zertifikat. Das Advisory braucht eine vom Angreifer gelieferte Signatur,
die kommt auf diesem Weg nicht vor. Kein Code in `apps/` oder `libs/` importiert
node-forge oder selfsigned.

## Verworfen: Override `selfsigned: ^5`

Ab Version 5 hängt selfsigned nicht mehr an node-forge, `generate()` ist dann aber
asynchron. `@rspack/dev-server@1.2.1` ruft die Funktion synchron auf, der HTTPS-Pfad
würde deshalb still brechen. Die Einzelheiten stehen im cloud-Befund zu #835.

## Maßnahme

`osv-scanner.toml`: `[[IgnoredVulns]]` für `GHSA-86w9-cpqp-85rv` mit
`ignoreUntil = 2026-11-02`. Läuft die Frist ab, wird osv-scanner wieder rot und erzwingt
die Neubewertung. Der Eintrag gilt laut Dateikopf auch für
`tools/scripts/osv-edge-advisories.sh`. Dort ist er wirkungslos, aber harmlos, weil
node-forge nicht im Image steckt (siehe unten).

## Gemessen (`origin/main` @ `fd44f544`)

| Messung | Ergebnis |
| --- | --- |
| `pnpm why node-forge` | genau ein Pfad, über `devDependencies` (`@nx/angular`) |
| `pnpm why node-forge --prod` | leer |
| `pnpm audit --audit-level=moderate --prod` | `No known vulnerabilities found` |
| `pnpm audit --audit-level=low` (ohne `--prod`) | kein node-forge-Treffer |
| Edge-Image | `tools/docker/Dockerfile.edge` führt `pnpm prune --prod` aus, bevor `node_modules` ins Laufzeit-Image kopiert wird |
| `osv-scanner scan source --config osv-scanner.toml -L pnpm-lock.yaml` | `Filtered 1 vulnerability`, `No issues found`, Exit 0 |

## Offen

- Sobald node-forge eine Fix-Version hat: Override-Floor setzen, Eintrag entfernen.
- Die Edge-Stückliste wurde nicht neu gebaut. Dass node-forge fehlt, folgt aus
  `pnpm why --prod` und dem `prune`, gemessen am Image ist es nicht.
