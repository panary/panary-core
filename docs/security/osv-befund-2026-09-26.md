---
type: Report
title: OSV-Befund 2026-09-26 — image-size-Ignores entfernt, die Advisories erfassen 0.5.5 nicht mehr
description: Beide image-size-Advisories sind seit dem 2026-09-24 auf ICNS ab 0.6.3 und JXL/HEIF ab 1.2.0 eingegrenzt, und das Lockfile führt nur 0.5.5, das keinen der drei Parser enthält — der befristete Ignore ist entfernt, und der vorgemerkte Override-Floor ^2.0.4 entfällt, weil er less auf eine API-inkompatible Major-Version gezwungen hätte.
tags: [security, supply-chain, dependencies, ci]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-09-26T06:45:00.000Z }
---

# OSV-Befund 2026-09-26 — image-size-Ignores entfernt, die Advisories erfassen 0.5.5 nicht mehr

## Auslöser: ein Aufräum-Termin, dessen Vorbedingung gekippt war

`osv-scanner.toml` ignorierte GHSA-5p2g-fcmc-qvqq und GHSA-w3rx-r6r6-pgpr (je CVSS 8.7)
befristet bis 2026-11-07 ([OSV-Befund 2026-08-07](osv-befund-2026-08-07.md)). Am
2026-09-14 erschienen image-size 2.0.3 und 2.0.4. Vorgemerkt war, den Ignore nach der
Karenzreife von 2.0.4 (2026-09-21 16:38 UTC) durch einen Override-Floor zu ersetzen —
nach dem Muster von adm-zip 0.6.1 ([OSV-Befund 2026-09-15](osv-befund-2026-09-15.md)).

Beim Einlösen am 2026-09-26 neu gemessen: Beide Advisories waren zwei Tage vorher
eingegrenzt worden. Der Floor war damit weder nötig noch harmlos. Umgesetzt in
panary/panary-core#397, Pendant panary/panary-cloud#586.

## Was sich an den Advisories geändert hat

| Advisory | Parser | betroffen bis 2026-09-24 | betroffen seit 2026-09-24 | Fix |
| --- | --- | --- | --- | --- |
| [GHSA-5p2g-fcmc-qvqq](https://osv.dev/GHSA-5p2g-fcmc-qvqq) (CVE-2025-71329) | JXL/HEIF | `<= 2.0.2` | `>= 1.2.0, <= 2.0.2` | 2.0.3 |
| [GHSA-w3rx-r6r6-pgpr](https://osv.dev/GHSA-w3rx-r6r6-pgpr) (CVE-2025-71330) | ICNS | `<= 2.0.2` | `>= 0.6.3, <= 2.0.2` | 2.0.3 |

Zeitpunkte: GitHub `updated_at` 2026-09-24 18:28 bzw. 18:23 UTC, osv.dev `modified`
18:45 bzw. 18:30 UTC. osv.dev ist die Datenquelle von osv-scanner. Wie bei nanoid
([OSV-Befund 2026-08-13](osv-befund-2026-08-13.md)) war es eine Modifikation eines
bestehenden Advisories, keine Neuveröffentlichung — diesmal in die entwarnende Richtung.

## 0.5.5 ist nicht betroffen — am Code geprüft, nicht am Advisory

Einem Advisory ist in keiner Richtung ungeprüft zu glauben; bei adm-zip nannte es
tagelang keine Fix-Version, obwohl der Fix veröffentlicht war. Deshalb das
Parser-Verzeichnis `lib/types/` je Tag:

| Tag | Parser |
| --- | --- |
| `v0.5.5` | bmp, dds, gif, jpg, png, psd, svg, tiff, webp |
| `v0.6.2` | zusätzlich cur, ico |
| `v0.6.3` | zusätzlich **icns** |
| `v1.1.1` | zusätzlich **heif**, j2c, jp2, ktx, pnm, tga |
| `v1.2.0` | zusätzlich **jxl**, jxl-stream |

`image-size@0.5.5` enthält keinen der drei betroffenen Parser. Die ICNS-Untergrenze
deckt sich mit dem Tag, der den Parser einführt. Bei JXL/HEIF liegt sie auf 1.2.0,
obwohl HEIF schon in 1.1.x steckt — für dieses Repo unerheblich.

```bash
for ref in v0.5.5 v0.6.2 v0.6.3 v1.1.1 v1.2.0; do
  printf '%-8s ' "$ref"
  gh api "repos/image-size/image-size/contents/lib/types?ref=$ref" --jq '[.[].name] | join(" ")'
done
```

## Gemessen: Lockfile, Scan, Mutationsprobe

Das Lockfile führt genau eine Version, eingezogen als `optionalDependency` von `less`
(4.5.1 und 4.6.4 deklarieren beide `"image-size": "~0.5.0"`):

```bash
grep -oE '^  image-size@[0-9.]+' pnpm-lock.yaml | sort -u    # image-size@0.5.5
```

| Messung (osv-scanner 2.3.8, Lockfile von `origin/main` @ `feba0c98`) | Ergebnis |
| --- | --- |
| mit der bisherigen `osv-scanner.toml` | `No issues found`, dazu `osv-scanner.toml has unused ignores: GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr` — Exit 0 |
| ohne jede Config | 0 Befunde, Exit 0 |
| osv.dev `querybatch`, image-size 0.5.5 / 1.2.1 / 2.0.2 / 2.0.4 | keine / beide IDs / beide IDs / keine |
| nach der Änderung: `node scripts/security-scan.mjs --mode=local --format=json` | Exit 0, `complete: true`, `scanErrors: []`, 0 Befunde |

Die erste Zeile ist genau der Fall, vor dem der OSV-Befund 2026-08-07 in seiner
Verifikation warnt: Einen toten Ignore quittiert osv-scanner mit einer Textzeile und
Exit 0.

**Mutationsprobe** — Wegwerf-Kopie des Lockfiles, alle vier `image-size`-Stellen auf das
tatsächlich betroffene 2.0.2 gesetzt:

| Config | Ergebnis |
| --- | --- |
| bisherige `osv-scanner.toml` | 0 Befunde, Exit 0 — beide IDs `filtered out` mit der Begründung „Kein Fix verfuegbar" |
| neue, eintragslose `osv-scanner.toml` | 2 Befunde (GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr), Exit 1 |

Der tote Ignore hätte also bis 2026-11-07 jedes wirklich betroffene image-size still
unterdrückt, das über einen anderen Pfad einzieht.

```bash
curl -s -X POST https://api.osv.dev/v1/querybatch \
  -d '{"queries":[{"package":{"name":"image-size","ecosystem":"npm"},"version":"0.5.5"}]}'
# {"results":[{}]} — keine Advisories für 0.5.5
```

## Warum kein Override-Floor

Der vorgemerkte Floor `image-size: ^2.0.4` hätte eine unbetroffene Version durch eine
inkompatible ersetzt:

- `less` ruft (less.js, `packages/less/src/less-node/image-size.js`, Tag `v4.5.1`)
  `const sizeOf = require('image-size'); return sizeOf(fileSync.filename);` — das Modul
  als Funktion, mit einem Dateipfad.
- 0.5.5 exportiert genau das: `module.exports = function (input, callback)`, Pfad oder
  Buffer.
- 2.x exportiert `{ disableTypes, imageSize, imageSize as default }`. `require('image-size')`
  liefert also ein Objekt, und `imageSize` nimmt nur ein `Uint8Array`; Dateipfade gibt es
  nur noch asynchron über `image-size/fromFile`.

Mit dem Floor würfen die Less-Funktionen `image-size()`, `image-width()` und
`image-height()` `TypeError: sizeOf is not a function`. Das bliebe unsichtbar, solange
der Workspace 0 `.less`-Dateien hat — ein latenter Bruch ohne Sicherheitsgewinn. Das
adm-zip-Muster passte hier nicht: Dort war die aufgelöste Version selbst betroffen.

## Herkunft des Fixes — falls je ein Floor auf 2.x nötig wird

- Das GitHub-Repo `image-size/image-size` ist archiviert, sein letzter Tag ist `v2.0.2`.
  Entwickelt wird auf Codeberg (`codeberg.org/image-size/image-size`), und auch dort sind
  2.0.3 und 2.0.4 **nicht** getaggt. Ein GitHub-Compare `v2.0.2...v2.0.4` existiert
  deshalb nicht; sein Ersatz ist `v2.0.2...main` auf Codeberg (sieben Commits).
- npm: 2.0.3 am 2026-09-14 um 15:57 UTC, 2.0.4 um 16:38 UTC, Publisher wie bei 2.0.2
  (`netroy`) — aber ohne `gitHead` und ohne Provenance-Attestierung; `repository.url`
  zeigt jetzt auf Codeberg.
- Commit-Folge auf Codeberg: `e6e83a5` „fix infinite loops…" (14:35 UTC) → `cd9fc41`
  Build-Tooling → `fa82e6b` „2.0.3" → `8fec406` Bildanzahl in ico/cur prüfen → `f8d0d12`
  Tests → `763bf4e` „2.0.4".
- Der im Advisory verlinkte Fix `e6e83a5` bricht die Schleifen ab: `icns.ts` wirft bei
  einer Eintragslänge unter 8 (vorher lief `imageOffset += 0` endlos), `heif.ts` verlangt
  einen vorrückenden Offset und eine `ispe`-Box von mindestens 20 Bytes, `jxl.ts` eine
  `jxlp`-Box von mindestens 12 Bytes, und `findBox` springt über Boxen unter 8 Bytes hinweg.
- Karenz: 2.0.4 ist seit 2026-09-21 16:38 UTC reif.

Die Zuordnung Tarball ↔ Commit ist damit nur über Zeitstempel und die Versions-Commits
belegt, nicht über `gitHead`. Wer später doch einen 2.x-Floor braucht, vergleicht vorher
den Tarball-Inhalt mit dem Codeberg-Stand.

## Was jetzt gilt

- `osv-scanner.toml` trägt keinen Eintrag mehr. Die Datei bleibt, weil
  `scripts/security-scan.mjs` sie per `--config` weiterreicht
  ([Lockfile-Auflösung](security-scan-lockfile-aufloesung.md)) — ein künftiger Eintrag
  gilt damit sofort für jedes gescannte Lockfile.
- Kein Override, das Lockfile ist unverändert.
- Zieht künftig ein Paket ein betroffenes image-size (≥ 0.6.3, < 2.0.3) ein, meldet der
  Scan es. Die Behebung wäre dann ein eigener Schritt: Auch für Konsumenten mit
  1.x-API ist 2.x ein Major-Sprung.
- Eine Frist gibt es nicht mehr. Weitet sich die Advisory-Range wieder aus (Muster
  nanoid), schlägt der Scan an, statt still zu filtern.

## Ältere Seiten

- [OSV-Befund 2026-08-07](osv-befund-2026-08-07.md) trägt einen Nachtrag; sein
  Aufräum-Termin ist erledigt.
- [Lockfile-Auflösung im Security-Scan](security-scan-lockfile-aufloesung.md): Die
  Messzeile „ohne `--config` → 2 × image-size" ist heute nicht mehr reproduzierbar; die
  Regel, `--config` explizit mitzugeben, bleibt.

Verwandt: [ADR 0012 — pnpm-Supply-Chain-Härtung](../adr/0012-pnpm-supply-chain-haertung.md),
[OSV-Befund 2026-09-15](osv-befund-2026-09-15.md) (adm-zip, das Floor-Muster). Das
Pendant in panary-cloud (`docs/security/osv-befund-2026-09-26.md`) behandelt zusätzlich
das `pnpm audit`-Gate.
