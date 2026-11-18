---
type: Report
title: OSV-Befund 2026-11-18 — picomatch und chrono befristet akzeptiert, deepmerge-Ignore entfernt
description: Der Security-Scan auf main war seit dem 2026-11-17 rot, die rote Reihe reicht bis 2026-11-11 zurück. Ursachen sind picomatch GHSA-fc5q-39xc-vjpf (kein Fix, nur Dev-Pfade) und chrono RUSTSEC-2026-0543 (unmaintained, im POS-Crate nicht aktiv), dazu ein überflüssiger deepmerge-Ignore. Beide Befunde stehen bis 2026-12-15 in osv-scanner.toml, der deepmerge-Eintrag ist entfernt.
tags: [security, supply-chain, dependencies, ci]
status: stable
stale_after: 2026-12-15
generated: { by: claude-code/sonnet-5.5, at: 2026-11-18T16:30:00.000Z }
---

# OSV-Befund 2026-11-18 — picomatch und chrono befristet akzeptiert, deepmerge-Ignore entfernt

## Auslöser

Der Job `osv-scanner (SCA)` im Workflow „Security Scan" schlug auf `main` fehl, zuletzt im Lauf vom 2026-11-18 13:06 UTC.
Der Scan lief schon vorher rot und hängt nicht an einem Diff: Auch der PR-Lauf von
[#1501](https://github.com/panary/panary-core/pull/1501) war rot, ohne dass dessen Änderung Abhängigkeiten berührte.
Weil der Check kein Pflicht-Check ist, sperrte er keinen Merge, überdeckte aber jeden neuen Befund
([#1497](https://github.com/panary/panary-core/issues/1497)). `release-pos.yml` scannt nicht, ein `pos-v*` war nie blockiert.

| Fund | Lockfile | Art |
| --- | --- | --- |
| [RUSTSEC-2026-0543](https://osv.dev/RUSTSEC-2026-0543) `chrono` 0.4.44 | `apps/pos-client/src-tauri/Cargo.lock` | unmaintained, alle Versionen, keine Schwachstelle |
| [GHSA-fc5q-39xc-vjpf](https://osv.dev/GHSA-fc5q-39xc-vjpf) `picomatch` 2.3.2, 4.0.4, 4.0.7 | `pnpm-lock.yaml` | ReDoS über Extglob-Muster, CVSS 8.7, `last_affected` 4.0.7, keine gefixte Version |
| Unused ignore `GHSA-gcqx-w48m-w2h4` (deepmerge) | `osv-scanner.toml` | Eintrag ohne Treffer |

## Messung

**picomatch.** Die Schwachstelle liegt im Übersetzen eines *Musters* in einen regulären Ausdruck, nicht im Abgleich
eines Pfads. `pnpm why picomatch --prod` ist leer: picomatch hängt nur in Dev-Werkzeugen (nx, `@nx/*`, jest, vite,
vitest, `@angular/build`, `@angular/cli`, angular-eslint), steckt damit weder im Edge-Image noch in einem
ausgelieferten Bundle. Die Muster stammen aus eigener Test-, Build- und Lint-Konfiguration. npm führt keine Version
über 4.0.7, ein Override ist nicht möglich. Das Gegenstück in panary-cloud ist
[panary-cloud#2165](https://github.com/panary/panary-cloud/issues/2165).

**chrono.** `chrono` ist im `Cargo.lock` nur als optionale Abhängigkeit (Feature `chrono_0_4`) von `serde_with` 3.21.0
verzeichnet, deren einziger Parent `tauri-utils` ist. Aktiv sind an `serde_with` allein `alloc`, `default`, `macros`
und `std` (`cargo metadata --locked`). `cargo tree -i chrono --locked --target all -e all` findet auch mit
`--all-features` keinen Pfad vom POS-Crate (`warning: nothing to print`). chrono wird demnach in keinem Ziel
kompiliert und steckt in keinem ausgelieferten POS-Artefakt. Die Meldung ist außerdem reine „unmaintained"-Information
(`informational = unmaintained`), nicht ausnutzbar.

**deepmerge.** Die OSV-Datenbank liefert für `deepmerge` 4.3.1 (im Lockfile weiterhin vorhanden) auf eine
`/v1/query`-Abfrage keinen Treffer mehr; die Advisory wurde am 2026-11-16 18:55 UTC geändert. Der Scanner meldete den
Ignore deshalb als „unused" (Exit 1 auf dem Scan, der ihn nicht von sich aus rot macht). Das Pendant in panary-cloud
ist [panary-cloud#2174](https://github.com/panary/panary-cloud/issues/2174).

## Entscheidung

* **picomatch**: befristeter Ignore bis **2026-12-15** in `osv-scanner.toml`. Ein `pnpm audit`-Gegenstück entfällt,
  panary-core führt keinen `auditConfig`.
* **chrono**: befristeter Ignore bis **2026-12-15** in `apps/pos-client/src-tauri/osv-scanner.toml`. osv-scanner
  liest Konfigurationen nur neben dem gescannten Manifest, die Datei des Hauptverzeichnisses gilt dort nicht.
* **deepmerge**: Ignore entfernt, mit Vermerk im Kopf der Datei.

Kein Override und kein `cargo update`: es gibt für beide Befunde keine gefixte Version, und ein Override auf eine
andere Major-Version bräche nx und glob (siehe [minimatch-Befund](osv-befund-2026-11-09-minimatch-11-blockiert.md)).

## Wiedervorlage

Zum Ablauf am 2026-12-15, spätestens sobald die picomatch-Advisory eine `first_patched_version` führt: Override
heben und den Eintrag entfernen. Für chrono prüfen, ob `serde_with` chrono nicht mehr als optionale Abhängigkeit
führt oder chrono wieder gepflegt wird; sonst erneut messen, ob ein Pfad vom POS-Crate entstanden ist, und die Frist
mit neuer Begründung verlängern. Ein Eintrag, den der Scanner als „unused" meldet, gehört entfernt.
