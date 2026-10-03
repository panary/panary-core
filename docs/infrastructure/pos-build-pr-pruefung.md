---
type: Guide
title: POS-Build-Prüfung — Tauri-Paket im PR und auf main, zwei Stufen, was sie nicht sieht
description: Der Rust-/Tauri-Teil des POS wird im PR gebaut, sobald src-tauri oder die npm-Seite von Tauri berührt ist; Linux-Stufe mit Versionsabgleich npm↔Crate bei jedem Treffer, Windows-NSIS-Build nur bei Cargo-, Config- oder Workflow-Änderung; Trefferquote, Laufzeiten, Fehlerklassen je Stufe und die Lücken.
tags: [ci, pos, tauri, rust, gates]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-03T12:00:00Z }
---

# POS-Build-Prüfung — PR und main

## Problem

Die PR-CI (`ci.yml`) baut das Angular-Frontend des POS (`nx affected -t build`), den
Rust-/Tauri-Teil unter `apps/pos-client/src-tauri/` aber nie. Das tun nur
`build-pos.yml` (per Dispatch, Windows + macOS) und `release-pos.yml` (beim `pos-v*`-Tag).
Der Check `Analyze (rust)` an jedem PR stammt aus CodeQL und meldet nur Sicherheitsbefunde.

Ein Bruch fiel deshalb erst beim Release auf. So geschehen bei `pos-v26.9.1`/`.2`
([#266](https://github.com/panary/panary-core/issues/266)): `@tauri-apps/plugin-updater`
auf npm-Seite und die Crate `tauri-plugin-updater` standen auf verschiedenem
`major.minor`, und `tauri build` bricht dann ab. Dieselbe Falle war vor `pos-v26.9.14`
wieder offen ([#432](https://github.com/panary/panary-core/issues/432)). Gefunden wurde die
Lücke bei der Suche nach #505, Plan:
[#509](https://github.com/panary/panary-core/issues/509).

## Was läuft

`.github/workflows/pos-build-check.yml`, nur `contents: read`, kein Upload, kein
Signing-Key. Drei Jobs:

| Job | Wann | Was |
| --- | --- | --- |
| `changes` | immer | Diff gegen die Basis (PR: Base-Stand, main: Stand vor dem Push). Entscheidet über den Windows-Job; ist die Basis nicht abrufbar (Force-Push), läuft Windows |
| `build-linux` | jeder Treffer des Filters | `cargo fmt --check`, `pnpm tauri build --debug --no-bundle -- --locked`, `cargo clippy --locked --all-targets -- -D warnings` |
| `build-windows` | nur bei `Cargo.lock`, `Cargo.toml`, `tauri*.conf.json`, `build.rs` oder einem der drei POS-Workflows | `pnpm tauri build --bundles nsis -- --locked` im Release-Profil, Installer muss entstehen |

Beide Build-Jobs nehmen statt des Angular-Builds einen Platzhalter unter
`dist/apps/pos-client/browser`: Das Frontend baut `ci.yml`, und `tauri-build` verlangt nur,
dass `frontendDist` existiert. Updater-Artefakte sind wie in `build-pos.yml` per
Config-Override aus, der Signing-Key bleibt dem Release vorbehalten.

Der Rust-Cache wird nur auf `main` geschrieben (`save-if`). PR-Läufe lesen ihn. Ein
PR-Eintrag wäre nur für denselben PR lesbar und belegte das 10-GB-Kontingent.

## Welche Stufe welchen Fehler fängt

| Fehlerklasse | Beispiel | Linux | Windows |
| --- | --- | --- | --- |
| Rust-API-Bruch durch Cargo-Bump oder eigenen Code | `mdns-sd` 0.11 → 0.20 (#85) | ja | ja |
| Versionsabgleich npm ↔ Crate (`major.minor`) | #266, #432 | ja (Tauri-CLI prüft vor dem Kompilieren) | ja |
| Link-Fehler, `tauri-build`-Fehler (Capabilities, Config-Schema) | — | ja | ja |
| `cargo fmt`, `clippy -D warnings` | — | ja | nein |
| Bruch, der nur unter Windows auftritt (windows-sys, webview2, NSIS-Config) | in der Historie keiner | nein | ja |
| Angular-Build des POS | — | nein, macht `ci.yml` | nein |

Die App selbst hat keinen `cfg(windows)`-Code (nur `windows_subsystem` in `main.rs`),
Linux kompiliert also denselben App-Code. Plattformabhängig sind nur Abhängigkeiten.

Ein `cargo check --target x86_64-pc-windows-msvc` auf Linux oder macOS ersetzt den
Windows-Job nicht: Er scheitert schon an `ring` (C-Build-Skript braucht MSVC-Header).
Gemessen 2026-10-03.

## Wann er läuft

**Pfadfilter** (PR und main-Push, derselbe): `apps/pos-client/src-tauri/**`,
`apps/pos-client/project.json`, `package.json`, `pnpm-lock.yaml` und die Workflows
`build-pos.yml`, `release-pos.yml`, `pos-build-check.yml`. Die Root-`package.json` steht
drin, weil Tauri-CLI und -Plugins dort liegen. Ihre Version muss zur Crate passen.

**Gemessen** an den 80 gemergten PRs #328–#510 (2026-10-03):

| Filter | Treffer |
| --- | --- |
| nur `src-tauri/**` | 3 (alle Dependabot-Cargo-Bumps: #462, #464, #466) |
| ganzer Filter | 22, darunter die Tauri-npm-Bumps #426 und #433 |
| Windows-Teilmenge | 3 (dieselben wie `src-tauri/**`) |

Etwa 19 der 22 Läufe treffen npm-Bumps ohne Tauri-Bezug. Das ist bewusst so: Der Filter
kann nicht in den Diff sehen, und ein Lauf ist kein Pflicht-Check, er hält also keinen PR auf.

Die Release-Commits (`chore(release): v…`) heben die Version in `tauri.conf.json`, gehen
aber direkt auf `main`. Dort läuft der Workflow per `push`-Trigger, inklusive Windows-Job.

Nachmessen:

```bash
gh pr list --repo panary/panary-core --state merged --limit 80 --json number,files \
  --jq '.[]|"\(.number) \([.files[].path]|join(" "))"'
```

## Laufzeiten

| Lauf | Dauer | Quelle |
| --- | --- | --- |
| `cargo check` lokal (12 Kerne), kalt / warm | 21 s / 1 s | gemessen 2026-10-03 |
| `tauri build --debug --no-bundle` lokal, kalt | 31 s | gemessen 2026-10-03 |
| `build-pos.yml` Windows: Angular / Tauri | 3,5–5 min / 1,5–4,5 min | letzte 3 Läufe |
| `release-pos.yml` Windows: Tauri (Cache leer) | 6–7 min | letzte 3 Läufe |

Die Läufe von `pos-build-check.yml` selbst stehen im PR #509 bzw. in dessen Actions-Läufen.
`panary-core` ist öffentlich, Standard-Runner kosten also auch für Windows kein Geld, sondern
nur Wartezeit.

## Was ein grüner Lauf nicht zeigt

- **macOS.** Kein macOS-Job. `tauri.macos.conf.json` löst den Windows-Job zwar aus, gebaut
  wird sie aber nur von `build-pos.yml` und `release-pos.yml`.
- **Die Neuauflösung im Release.** `release-pos.yml` löscht das Lockfile und löst neu auf
  (`pnpm install --lockfile-only`). Die Prüfung installiert dagegen vom committeten Lockfile
  aus (`--no-frozen-lockfile` wie `ci.yml`, nur `Cargo.lock` ist per `--locked` fixiert). Seit
  #433 halten Tilde-Ranges die Tauri-Plugins auf der Minor-Version der Crate. Eine neue
  Tauri-Abhängigkeit mit Caret-Range öffnet die Lücke wieder.
- **Signierung, Updater-`latest.json`, Stückliste, Installation auf dem Gerät.** Das bleibt
  Sache von `release-pos.yml` und des Geräts.
- **Verhalten.** Kompiliert ist nicht geprüft: LAN-Discovery (mDNS), MQTT-Druck und Updater
  sieht erst ein Smoke-Test am Gerät.
- **Windows-Brüche über Pfade außerhalb der Teilmenge.** Ein neuer `cfg(windows)`-Block in
  `src-tauri/src/` löst nur den Linux-Job aus. Der kompiliert diesen Block nicht.
