---
type: Report
title: OSV-Befund 2026-09-04 — browserslist, fast-uri und qs per Override-Floor geschlossen
description: Neun am 01./02.09. veröffentlichte Advisories (browserslist 2×, fast-uri 4×, qs 2×) ließen den nächtlichen OSV-Scan ab dem 2026-09-02 rot werden; alle drei Pakete sind rein transitiv und über Override-Floors geschlossen — qs 6.16.0 nur mit befristeter Karenz-Ausnahme, weil die Version erst am 2026-09-05 23:50 UTC reif wird.
tags: [security, supply-chain, dependencies, ci]
status: stable
generated: { by: claude-code/fable-5.1, at: 2026-09-04T12:30:00.000Z }
---

# OSV-Befund 2026-09-04 — browserslist, fast-uri und qs per Override-Floor geschlossen

## Auslöser

Der `osv-scanner`-Job des nächtlichen Security-Scans lief am 2026-09-01 noch
grün und ab dem **2026-09-02** rot — bei unverändertem `main` (`d2c9085b` in
allen vier Läufen). Ursache sind neun Advisories, die am 01./02.09. veröffentlicht
und am 03.09. noch einmal überarbeitet wurden:

| Advisory | Paket | Betroffen (Lockfile) | Fix | CVSS |
| --- | --- | --- | --- | --- |
| [GHSA-73wf-gq98-2v4g](https://osv.dev/GHSA-73wf-gq98-2v4g) | browserslist | 4.28.2, 4.28.6 | 4.28.7 | 7.5 |
| [GHSA-c83g-rgw3-j3cx](https://osv.dev/GHSA-c83g-rgw3-j3cx) | browserslist | 4.28.2, 4.28.6 | 4.28.7 | 7.5 |
| [GHSA-5jgf-p345-68v8](https://osv.dev/GHSA-5jgf-p345-68v8) | fast-uri | 3.1.5 | 3.1.6 | 7.5 |
| [GHSA-f65p-4m7j-42xc](https://osv.dev/GHSA-f65p-4m7j-42xc) | fast-uri | 3.1.5 | 3.1.6 | 7.5 |
| [GHSA-fph4-wmhf-6fwf](https://osv.dev/GHSA-fph4-wmhf-6fwf) | fast-uri | 3.1.5 | 3.1.6 | 7.5 |
| [GHSA-jqff-g426-hqxp](https://osv.dev/GHSA-jqff-g426-hqxp) | fast-uri | 3.1.5 | 3.1.6 | 7.5 |
| [GHSA-4mjr-xmp4-gh2g](https://osv.dev/GHSA-4mjr-xmp4-gh2g) | qs | 6.15.3 | 6.16.0 | 6.3 |
| [GHSA-x5fp-wj9c-mxmx](https://osv.dev/GHSA-x5fp-wj9c-mxmx) | qs | 6.15.3 | 6.16.0 | 6.3 |

Inhaltlich: browserslist stürzt bei einer untrusted `browserslist-stats.json`
ab bzw. wächst ohne Cache-Eviction unbegrenzt; fast-uri normalisiert Hosts falsch
(IDN, IPv6, wiederholtes Percent-Decoding, percent-kodiertes Schema) und öffnet
damit SSRF-/Host-Confusion-Pfade; qs lässt sich per angreiferkontrolliertem
`isBuffer` in einen DoS treiben und umgeht das Array-Limit über Komma-Parsing in
Bracket-Keys.

Derselbe Satz traf panary-cloud, dort zusätzlich `pacote@21.3.1`
(GHSA-w4pp-8pjf-rmxw, Range am 2026-08-29 erweitert) — geschlossen über den
Angular-Lockstep, siehe das cloud-Pendant dieses Befunds.

## Herkunft — alles transitiv, nichts davon ist ein direkter Import

Gemessen im committeten `pnpm-lock.yaml` (Stand `origin/main`):

- **browserslist** liegt dreifach vor: 4.28.2 über `ng-packagr@21.2.5`, 4.28.6
  über `@angular/build` und `@babel/helper-compilation-targets`, 4.28.7 bereits
  über einen weiteren Konsumenten. Reines Build-Tooling; der verwundbare Pfad
  (Custom-Stats-Datei) wird im Repo nicht benutzt.
- **fast-uri** 3.1.5 kommt über `ajv` (Schema-Validierung in TypeBox/Feathers).
  Das ist Laufzeitcode am Edge — Host-Normalisierung von Schema-URIs, keine
  Netzwerkanfrage, aber ein Pfad, der Eingaben verarbeitet.
- **qs** 6.15.3 hängt an `express@4/5`, `body-parser@1/2`, `co-body`, `koa-qs`
  und `@feathersjs/rest-client`. Das ist der Query-Parser des REST-Transports
  am Edge — angreifererreichbar, deshalb auch mit CVSS 6.3 nicht aufschiebbar.

## Entscheidung: Override-Floors, einmal mit befristeter Karenz-Ausnahme

Alle drei Fix-Versionen existieren, also gilt Weg 1 aus der cloud-Doku
`docs/security/security-gates-und-supply-chain-karenz.md` (panary-cloud, gilt
für beide Repos): den Floor in `pnpm.overrides` heben, kein Ignore.

| Paket | Override vorher | nachher | Fix publiziert | reif seit/ab |
| --- | --- | --- | --- | --- |
| browserslist | — (neu) | `^4.28.7` | 4.28.7: 2026-07-21, 4.28.8: 2026-08-08 09:59 UTC | 2026-08-15 |
| fast-uri | `^3.1.5` | `^3.1.6` | 2026-08-23 01:42 UTC | 2026-08-30 |
| qs | `^6.15.2` | `^6.16.0` | 2026-08-29 23:50 UTC | **2026-09-05 23:50 UTC** |

**qs ist der Sonderfall.** Bei `minimumReleaseAge: 10080` liegt im Range
`^6.16.0` am 2026-09-04 keine reife Version — jede Neuauflösung bräche mit
`ERR_PNPM_NO_MATURE_MATCHING_VERSION` ab. Deshalb trägt
`minimumReleaseAgeExclude` einen **befristeten** Eintrag `qs`, mit dem
Reife-Datum im Zeilenkommentar. Die Abwägung gegen das Warten (wie am
[2026-08-13](osv-befund-2026-08-13.md) bei nanoid):

1. qs ist der Query-Parser des Edge-REST-Transports, also auf einem
   angreifererreichbaren Pfad — bei nanoid war die Vorbedingung nachweislich
   nicht erfüllt, hier ist sie es.
2. Der Eintrag verschiebt den Karenz-Schutz für genau ein Paket um einen Tag;
   qs 6.16.0 stammt vom Maintainer des Projekts (ljharb), mit Provenance.
3. Der Scan ist seit drei Nächten rot; jede weitere Nacht kostet die Aufmerksamkeit,
   die ein neuer Befund braucht.

> ⚠️ **Fällig ab 2026-09-05 23:50 UTC:** den `qs`-Eintrag aus
> `minimumReleaseAgeExclude` entfernen — in `panary-core/pnpm-workspace.yaml`,
> `panary-cloud/pnpm-workspace.yaml` und der Workbench-Root-`pnpm-workspace.yaml`.
> Das Entfernen ist lockfile-neutral (der Key steht nicht im Lockfile-Kopf, siehe
> Log vom 2026-08-11). Solange der Eintrag steht, ist er ein stiller Verzicht auf
> die Karenz für genau das Paket, das gerade erst gepatcht wurde.

## Verifikation

Im Worktree (**nicht** unterhalb von `.claude/` — osv-scanner überspringt
Punkt-Verzeichnisse und meldet dort „No issues found", ohne etwas gescannt zu
haben):

```bash
# Nachweis ist die Version im Lockfile, nie der Exit-Code:
grep -oE '^  (browserslist|fast-uri|qs)@[0-9.]+' pnpm-lock.yaml | sort -u
# Erwartung: browserslist@4.28.8, fast-uri@3.1.6, qs@6.16.0 — und KEINE 4.28.2/4.28.6/3.1.5/6.15.x mehr

osv-scanner scan --config osv-scanner.toml -L pnpm-lock.yaml
```

Den nächtlichen Lauf (`Security Scan`, 04:17 UTC) nach dem Merge einmal
abwarten — ein grüner PR-Lauf beweist den `main`-Lauf nicht, wenn zwischendurch
eine Advisory-Range wächst (Lehre vom 2026-08-13).
