---
type: Report
title: OSV-Befund 2026-09-15 — rustls 0.23.45 im POS-Client, adm-zip 0.6.1 löst den befristeten Ignore ab
description: Zwei Bewegungen am selben Tag — RUSTSEC-2026-0285 (rustls im Tauri-POS-Client, TLS-1.3-Handshake-Nachrichten über Verschlüsselungsgrenzen hinweg akzeptiert) ließ den osv-scanner-Check ab dem 2026-09-15 auf main und allen Dependabot-PRs rot werden und ist per cargo update auf 0.23.45 geschlossen; adm-zip 0.6.1 enthält den Symlink-Fix zu GHSA-vwc7-r8mq-g2x9 und ersetzt den bis 2026-12-10 befristeten Ignore durch einen Override-Floor.
tags: [security, supply-chain, dependencies, ci, pos-client]
status: stable
generated: { by: claude-code/fable-5.1, at: 2026-09-15T12:00:00.000Z }
---

# OSV-Befund 2026-09-15 — rustls 0.23.45 im POS-Client, adm-zip 0.6.1 löst den befristeten Ignore ab

## Befund

| Advisory | Paket | aufgelöst | Fix | CVSS | Lockfile |
| --- | --- | --- | --- | --- | --- |
| [RUSTSEC-2026-0285](https://osv.dev/RUSTSEC-2026-0285) / GHSA-2mjx-qc3c-rqvc | rustls | 0.23.40 | 0.23.45 | 5.3 | `apps/pos-client/src-tauri/Cargo.lock` |
| [GHSA-vwc7-r8mq-g2x9](https://osv.dev/GHSA-vwc7-r8mq-g2x9) / CVE-2026-76845 | adm-zip | 0.6.0 | 0.6.1 | 6.5 | `pnpm-lock.yaml` |

**rustls** (publiziert 2026-09-14): TLS-1.3-Handshake-Nachrichten wurden akzeptiert, wenn sie
nach einer schlüsselwechselnden Nachricht im selben Record folgten — etwa ein
`EncryptedExtensions` im Klartext direkt hinter dem `ServerHello`. Das Transkript bleibt
authentifiziert, ein Angreifer im Netz kann damit keinen Handshake ändern oder abschließen;
die praktische Wirkung ist, dass ein Peer Nachrichten unverschlüsselt senden kann, die
verschlüsselt sein müssten. Im POS-Client hängt rustls an `reqwest` (Updater-Plugin) und an
`tokio-rustls`/`tungstenite` (rumqttc, dort ohne aktivierte TLS-Features, ADR 0036). Der
Updater spricht ausschließlich `github.com`.

**Sichtbar geworden** über den nächtlichen `security.yml`-Lauf auf `main` (2026-09-15
09:24 UTC, `4ab3b49a`) und über jeden Dependabot-PR desselben Tages: `osv-scanner (SCA)` war
überall rot, `main` grün. Der Check ist bewusst nicht required — er blockiert keinen Merge,
aber er ist das einzige Gate, das die Cargo.lock überhaupt sieht ([core-CI baut kein
Rust](../guides/cargo-advisory-triage.md)).

## Entscheidung

| Paket | Maßnahme | Fix publiziert |
| --- | --- | --- |
| rustls | `cargo update -p rustls --precise 0.23.45` (zieht `rustls-webpki` 0.103.13 → 0.103.15 mit) | 2026-09-14 15:11 UTC |
| adm-zip | Override-Floor `^0.6.1` + befristete Karenz-Ausnahme bis 2026-09-18 10:24 UTC, Ignore entfernt — Details im [Nachtrag zum OSV-Befund 2026-09-10](osv-befund-2026-09-10.md#nachtrag-2026-09-15--adm-zip-061-schließt-den-befund) | 2026-09-11 10:24 UTC |

Für Cargo gibt es keine Karenz-Mechanik wie `minimumReleaseAge`; der Dependabot-Cooldown
(7 Tage) betrifft nur dessen eigene Vorschläge. Der Bump ist ein Patch innerhalb von
`0.23.x`, keine API-Änderung.

## Verifikation

Die reguläre CI kompiliert den Rust-Code nicht — die Kompilier-Prüfung ist lokal:

```bash
cd apps/pos-client/src-tauri
cargo fmt --check && cargo check --locked && cargo clippy --all-targets --locked -- -D warnings
osv-scanner scan --config osv-scanner.toml -L Cargo.lock   # Erwartung: nur die bekannten Filter, "No issues found"
```

Der echte Tauri-Build läuft erst im nächsten `build-pos.yml`-Dispatch bzw. `pos-v*`-Release;
bis dahin ist die Cargo.lock nur per `cargo check` belegt, nicht per Bundle.

Für adm-zip: `grep -oE "^  '?adm-zip@[0-9.]+" pnpm-lock.yaml` → `adm-zip@0.6.1`,
`osv-scanner scan --config osv-scanner.toml -L pnpm-lock.yaml` → kein „filtered out" mehr
für GHSA-vwc7-r8mq-g2x9.

Die Dependabot-Alerts (#316 adm-zip) schließen sich, sobald `main` die neuen Versionen trägt;
für rustls hat GitHub keinen Alert angelegt.

**Nachtrag 2026-09-20 — diese Verifikation führt im Haupt-Checkout in die Irre.**
Beide Befehle oben lesen `pnpm-lock.yaml` relativ zum Arbeitsverzeichnis, und in
`_WORKBENCH_PANARY/panary-core/` ist das ein Symlink aufs Workbench-Root-Lockfile.
Dort greift der Override-Floor `adm-zip ^0.6.1` nicht: Der `grep` liefert am
2026-09-20 `adm-zip@0.6.0`, meldet den korrekt gesetzten Floor also als
gescheitert. Im Worktree — wo laut Konvention gearbeitet wird — liefert er
`0.6.1`. Beide Prüfungen gehören deshalb in einen Worktree, nicht in den
Haupt-Checkout. Hintergrund und Korrektur des Scan-Skripts:
[Lockfile-Auflösung über einen Symlink](security-scan-lockfile-aufloesung.md).
