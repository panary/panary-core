---
type: Report
title: OSV-Befund 2026-11-24 — url und cookie bis zur Karenz befristet akzeptiert, picomatch-Ignore entfernt
description: osv-scanner war auf PRs ohne Bezug zum POS rot, weil url 2.5.8 (RUSTSEC-2026-0592) und cookie 0.18.1 (RUSTSEC-2026-0594) im POS-Cargo.lock stehen. Beide Fixes sind jünger als die 7-Tage-Karenz, der verwundbare Pfad ist im POS gemessen nicht erreichbar; befristete Ignores bis 2026-12-07, danach Bump. Der picomatch-Ignore ist entfernt, die Advisory ist zurückgezogen.
tags: [security, supply-chain, dependencies, ci, pos, cargo]
status: stable
stale_after: 2026-12-07
generated: { by: claude-code/opus-5.5, at: 2026-11-24T09:00:00.000Z }
---

# OSV-Befund 2026-11-24 — url und cookie bis zur Karenz befristet akzeptiert, picomatch-Ignore entfernt

## Auslöser

Der Check `osv-scanner (SCA)` ist seit dem 2026-11-22 auf PRs ohne Bezug zum POS-Rust-Stack rot, zuerst gesehen an
[#1518](https://github.com/panary/panary-core/pull/1518) ([#1519](https://github.com/panary/panary-core/issues/1519)).
Am 2026-11-23 kam ein zweiter Cargo-Befund hinzu.

| Fund | Lockfile | Fix | Fix veröffentlicht | Karenz-reif |
| --- | --- | --- | --- | --- |
| [RUSTSEC-2026-0592](https://osv.dev/RUSTSEC-2026-0592) `url` 2.5.8: Stack-Overflow in `Url::origin()` bei verschachtelten `blob:`-URLs | `apps/pos-client/src-tauri/Cargo.lock` | 2.5.9 | 2026-11-20 23:03 UTC | 2026-11-27 |
| [RUSTSEC-2026-0594](https://osv.dev/RUSTSEC-2026-0594) `cookie` 0.18.1: Nonce-Wiederholung privater Cookies nach `fork()` | `apps/pos-client/src-tauri/Cargo.lock` | 0.18.3 | 2026-11-23 07:45 UTC | 2026-11-30 |
| Unused ignore `GHSA-fc5q-39xc-vjpf` (picomatch) | `osv-scanner.toml` | — | Advisory am 2026-11-19 zurückgezogen | — |

## Messung

**url.** Der Fehler steckt allein in `Url::origin()` (und `url::quirks::origin()`, das darauf aufsetzt). Alle Quellen
der direkten `url`-Konsumenten im `Cargo.lock` wurden über `cargo metadata --locked` aufgelöst und nach
`.origin()` und `quirks::origin` durchsucht: reqwest 0.13.4, tauri 2.12.1, tauri-runtime und tauri-runtime-wry 2.12.1,
wry 0.57.0, tao 0.37.1, tauri-utils 2.10.1, tauri-codegen 2.7.1, tauri-plugin-opener 2.7.2, tauri-plugin-updater
2.14.1, tower-http 0.6.11, urlpattern 0.6.0 und schemars (0.8, 0.9, 1.2). Das Ergebnis ist **0 Treffer**, im POS-Crate
(`src/`) ebenfalls. Der verwundbare Pfad wird im POS damit nicht aufgerufen.

**cookie.** Die Advisory betrifft nur `PrivateJar`, also das Feature `private`. `cargo metadata --locked` löst
`cookie` 0.18.1 ohne jedes Feature auf (`features: []`), `PrivateJar` wird nicht kompiliert. Parents sind tauri,
tauri-runtime und wry. Das POS forkt nicht und betreibt keinen Webserver.

**picomatch.** Die GitHub-Advisory ist seit dem 2026-11-19 als „Withdrawn Advisory: … not a security issue" geführt.
osv-scanner meldete den Eintrag deshalb als „unused ignore".

## Entscheidung

* **url, cookie:** befristete Ignores bis **2026-12-07** in `apps/pos-client/src-tauri/osv-scanner.toml`, mit der
  Messung als Begründung. Kein `cargo update` vor der Reife: Für Cargo gibt es keine Werkzeug-Karenz wie
  `minimumReleaseAge`, die 7 Tage gelten über den Dependabot-Cooldown und die Supply-Chain-Regel. Der rustls-Bump vom
  [2026-09-15](osv-befund-2026-09-15.md) zog einen Fix nach einem Tag ein. Hier ist der Pfad nicht erreichbar, deshalb
  besteht kein Anlass für die Ausnahme.
* **picomatch:** Ignore entfernt, mit Vermerk im Kopf von `osv-scanner.toml`. Das Gegenstück in panary-cloud trägt den
  Eintrag noch und bekommt ein eigenes Issue.

## Verifikation

```bash
osv-scanner scan source -L pnpm-lock.yaml -L apps/pos-client/src-tauri/Cargo.lock
```

Gemessen am 2026-11-24 mit osv-scanner 2.3.8: Exit 0, „No issues found", keine Zeile „has unused ignores". Derselbe
Scan des Root-Lockfiles mit der bisherigen `osv-scanner.toml` meldete den picomatch-Eintrag als ungenutzt. Das
`Cargo.lock` ist unverändert, ein `build-pos.yml`-Lauf belegt hier nichts Neues.

## Wiedervorlage

Ab dem **2026-11-30** (beide Fixes reif):

```bash
cd apps/pos-client/src-tauri
cargo update -p url --precise 2.5.9
cargo update -p cookie --precise 0.18.3   # nicht 0.19.0-rc.0
git diff --stat Cargo.lock                # nur die beiden Blöcke, sonst Alter der Mitgezogenen prüfen
cargo check --locked
```

Danach beide Einträge entfernen; der Scanner meldet sie sonst als „unused". Spätestens zum Ablauf am 2026-12-07 wird
der Scan ohne Bump wieder rot.
