---
type: Guide
title: Cargo-Advisories triagieren — vom osv-scanner-Befund zur Entscheidung
description: Reihenfolge für osv-scanner-Befunde auf apps/pos-client/src-tauri/Cargo.lock — zuerst prüfen, ob die Crate überhaupt kompiliert wird, dann Bump über den Parent, Ignore erst zuletzt.
tags: [security, supply-chain, dependencies, ci, cargo, pos-client]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-04T00:00:00.000Z }
---

# Cargo-Advisories triagieren

Der `osv-scanner (SCA)`-Job scannt rekursiv **alle** Lockfiles, also auch
`apps/pos-client/src-tauri/Cargo.lock`. Ein Befund dort läuft anders als ein
npm-Befund: Es gibt keine `overrides`, keinen Karenz-Konflikt und keinen
Dependabot-PR, der das Problem nebenbei mitnimmt. Diese Seite gibt die
Reihenfolge vor.

Das npm-Pendant (Override-Floors, `minimumReleaseAge`) steht in
[ADR 0012](../adr/0012-pnpm-supply-chain-haertung.md) und in
`panary-cloud/docs/security/security-gates-und-supply-chain-karenz.md`.

---

## Schritt 0 — Wird die Crate überhaupt kompiliert?

**Immer zuerst.** Ein Eintrag in `Cargo.lock` beweist nicht, dass die Crate im
Build landet.

```bash
cargo tree -e all -i <crate> --target all
```

Antwortet Cargo mit `warning: nothing to print.`, ist die Crate in **keinem**
Ziel und unter **keinem** Feature Teil des Graphen — der Befund ist ein Phantom.

Warum das vorkommt: Cargo trägt optionale Dependencies eines Pakets in die
Lockfile ein und **entfernt sie nicht wieder**, wenn das Feature später nicht
mehr aktiviert wird. Erst wenn das Elternpaket selbst neu aufgelöst wird, fällt
der Eintrag raus. Eine frisch erzeugte Lockfile enthält ihn nicht:

```bash
# Gegenprobe in einer Kopie — niemals im Arbeitsbaum
cargo generate-lockfile && grep -c 'name = "<crate>"' Cargo.lock
```

Ein Phantom-Befund wird **nicht** ignoriert, sondern über Schritt 2 aus der
Lockfile entfernt. Ein Ignore-Eintrag wäre hier schlicht falsch: Er
dokumentierte ein akzeptiertes Risiko, wo gar keines existiert.

## Schritt 1 — Direkter Bump

```bash
cargo update -p <crate> --precise <fix-version> --dry-run
```

Scheitert das an einer zu engen Range, nennt die Fehlermeldung die vollständige
Kette bis zum eigenen Paket — das ist die Information für Schritt 2. Ein
`[patch]`-Override ist **kein** Ersatz: Er verlangt Semver-Kompatibilität und
scheidet bei einem Major-Sprung (0.7 → 0.8) aus.

## Schritt 2 — Den Parent neu auflösen

Nicht die betroffene Crate updaten, sondern das Paket, über das sie hereinkommt:

```bash
cargo update -p <direkter-dependency-parent>
```

Das ist der Regelfall für Phantom-Befunde und für Transitive, deren Fix
upstream schon eingebaut ist. `cargo update -p <crate>` allein hilft nicht,
wenn die Version unverändert bleibt — dann bleibt auch die Dependency-Liste in
der Lockfile stehen.

**Nicht** `cargo generate-lockfile` im Arbeitsbaum: Das hebt in diesem Repo
~280 Pakete gleichzeitig an und macht aus einem Security-Fix ein unprüfbares
Diff.

## Schritt 3 — Befristeter Ignore

Erst wenn 0–2 nichts hergeben, also: kein Fix veröffentlicht, oder der Fix
hängt an einem Stack, der nicht isoliert bewegt werden kann (GTK3-Bindings,
`plist` → `quick-xml`). Eintrag in `apps/pos-client/src-tauri/osv-scanner.toml`
mit Begründung, Exposure-Einschätzung und Re-Evaluierungs-Bedingung.

Die ID muss die sein, unter der osv-scanner tatsächlich meldet: Bei Aliassen
filtert er den Partner selbst mit, und ein zusätzlicher Eintrag taucht dann als
`has unused ignores` auf (so geschehen bei glib, `RUSTSEC-2024-0429` vs.
`GHSA-wrw7-89jp-8q8g`).

---

## Zwei Fallstricke bei der Verifikation

**Die Core-CI baut kein Rust.** `ci.yml` kennt keinen Cargo-Job — ein
Lockfile-Bump geht mit grünen Checks durch, ohne je kompiliert worden zu sein.
Kompiliert wird erst in `build-pos.yml` / `release-pos.yml`, also nach dem
Merge. Deshalb **vor** dem PR lokal:

```bash
cargo check --locked
```

`--locked` ist der Punkt: Es schlägt fehl, sobald die Lockfile für ein Ziel
unvollständig wäre. Ergänzend, weil der Mac-Host nur eines der drei
Release-Ziele abdeckt:

```bash
for t in x86_64-unknown-linux-gnu x86_64-pc-windows-msvc aarch64-apple-darwin; do
  cargo tree --locked --target "$t" >/dev/null && echo "$t OK"
done
```

**osv-scanner überspringt Punkt-Verzeichnisse.** In einem Worktree unterhalb
von `.claude/` scannt er nichts und meldet trotzdem „No issues found" — ein
falsches Grün. Lockfile und `osv-scanner.toml` zum Gegenprüfen in ein
Verzeichnis ohne Punkt-Komponente kopieren:

```bash
osv-scanner scan source --recursive ./
```

Gegen den Stand **vor** der Änderung laufen lassen und den erwarteten Befund
tatsächlich sehen — sonst ist unbewiesen, dass der Scan greift.

---

## Beispiel: RUSTSEC-2026-0235 (rkyv), 2026-08-04

Gemeldet: `rkyv 0.7.46`, Fix in `0.8.17` (Out-of-bounds-Read über
Shared-Pointer-Validierung). Der nächtliche Scan war noch grün — das Advisory
erschien im Lauf des Tages und traf `main` wie jeden PR.

Schritt 0 antwortete `nothing to print`: `rkyv` ist eine **optionale**
Dependency von `rust_decimal` (`rkyv = ["dep:rkyv"]`), und das Feature war nie
aktiviert — `byte-unit` zieht `rust_decimal` nur mit `std`. Die Crate stand seit
je in der Lockfile, ohne je kompiliert worden zu sein.

Schritt 1 scheiterte erwartungsgemäß (`rust_decimal` verlangt `^0.7.46`).
Schritt 2 traf: Die Kette war
`tauri-plugin-log → byte-unit → rust_decimal → rkyv`, und
`tauri-plugin-log 2.9.0` (2026-07-13) hat `byte-unit` upstream entfernt.
`cargo update -p tauri-plugin-log` hob genau ein Paket an und ließ 28 tote
Pakete fallen — den gesamten Zweig samt `bitvec`, `borsh`, `rand` und
`zerocopy`. Kein Ignore-Eintrag nötig, `cargo check --locked` unverändert grün.

Die Lehre entspricht der npm-Seite: **erst prüfen, ob es einen echten Weg
gibt.** Auf der Cargo-Seite ist der erste dieser Wege die Frage, ob der Befund
überhaupt real ist.
