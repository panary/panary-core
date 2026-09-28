---
type: ADR
title: 'Stückliste je Release: CycloneDX aus dem Image-Scan, als Attestation und Release-Asset'
description: 'ADR zur Stückliste (SBOM) des Edge-Images: Format CycloneDX-JSON, erzeugt per syft aus dem Image-Digest statt aus dem Lockfile, attestiert per actions/attest an denselben Digest wie die cosign-Signatur, dazu als Asset an einem GitHub-Release zum v*-Tag, das nie „Latest“ werden darf. Für das POS-Paket (pos-v*) aus den beim Build benutzten Lockfiles, npm und Cargo in einer Datei. Gilt auch für die weiteren Teile von panary/panary-workbench#47.'
tags: [edge, pos, ci, docker, tauri, supply-chain, security]
status: stable
decision: accepted
implementation: 'Edge umgesetzt 2026-09-27 (#420) in .github/workflows/build-edge-docker.yml, wirksam ab dem ersten v*-Tag nach dem Merge. POS umgesetzt 2026-09-28 (#421) in .github/workflows/release-pos.yml, wirksam ab dem ersten pos-v*-Tag nach dem Merge.'
generated: { by: claude-code/opus-5.5, at: 2026-09-27T21:30:00Z }
sources:
  - { id: cra, resource: 'https://eur-lex.europa.eu/eli/reg/2024/2847/oj', title: 'Verordnung (EU) 2024/2847 — Cyber Resilience Act' }
  - { id: cyclonedx, resource: 'https://cyclonedx.org/specification/overview/', title: 'CycloneDX-Spezifikation' }
  - { id: gh-attest, resource: 'https://github.com/actions/attest', title: 'actions/attest' }
---

# Stückliste je Release: CycloneDX, Image-Scan, Ablage

## Problem

Das Edge-Image `ghcr.io/panary/panary-edge` ist per cosign signiert und trägt eine
SLSA-Provenance (`.github/workflows/build-edge-docker.yml`). Beides belegt, **woher** ein Image
kommt, nicht **was darin steckt**. Nach einem Advisory ließ sich nicht beantworten, ob Paket X
in `v26.9.9` enthalten ist. Der Cyber Resilience Act verlangt ab 2027-12-11 eine
maschinenlesbare Stückliste in der technischen Dokumentation; die Meldepflichten gelten schon
seit 2026-09-11, und ohne Stückliste sind sie praktisch nicht zu erfüllen.

## Entscheidung

1. **Format CycloneDX (JSON).** Festgelegt von Michael am 2026-09-27 (panary/panary-workbench#47).
   Dateiname `panary-edge-<version>.cdx.json`.
2. **Erzeugt aus dem fertigen Image per Digest**, mit `syft` über `anchore/sbom-action`
   (auf SHA gepinnt, `syft-version` explizit gesetzt). Nicht aus dem Lockfile: Nur der
   Image-Scan erfasst die Debian-Pakete des Base-Images (`node:22-bookworm-slim`) und
   `node_modules` so, wie es tatsächlich im Image liegt. Das Lockfile beschreibt den ganzen
   Workspace und nicht, was im Runtime-Stage ankommt.
3. **Plausibilitätsprüfung im Workflow.** Der Lauf wird rot, wenn die Stückliste keine
   `pkg:npm/`- oder keine `pkg:deb/`-Komponenten enthält, `better-sqlite3` fehlt oder die Datei
   16 MB erreicht (Grenze von `actions/attest`). Eine halbe Stückliste wäre sonst ein grüner
   Lauf mit wertlosem Inhalt. Kein `continue-on-error` auf den Stückliste-Schritten.
4. **Attestation per `actions/attest`** (`sbom-path`, `push-to-registry: true`) an **denselben
   Digest** wie cosign-Signatur und Provenance. Gewählt statt `cosign attest --type cyclonedx`,
   weil es dieselbe Mechanik wie die vorhandene Provenance ist: Sigstore public-good, Ablage in
   der GitHub-Attestation-API und in der Registry, Prüfung mit `gh attestation verify`.
   `actions/attest-sbom` ist seit v4 nur noch ein als deprecated markierter Wrapper darauf.
   Storage-Record ausgeschaltet: Er bräuchte zusätzlich `artifact-metadata: write` und trägt
   für die Stückliste nichts bei.
5. **Release-Asset an einem GitHub-Release zum `v*`-Tag**, angelegt im eigenen Job
   `release-sbom`. Nur dieser Job hat `contents: write`; der Build-Job führt Fremd-Actions aus
   und bekommt es nicht. Ablage **öffentlich**: Das Repo ist öffentlich, das Lockfile liegt
   ohnehin offen.
6. 🚨 **Das Edge-Release wird nie „Latest“.** Der POS-Updater fragt
   `releases/latest/download/latest.json` (`apps/pos-client/src-tauri/tauri.conf.json`), und
   `latest.json` hängt nur an `pos-v*`-Releases. Ein Edge-Release als Latest bedeutet einen 404
   auf jedem POS, der im UpdateService still verschluckt wird. Deshalb bei **jedem** Lauf
   `--latest=false` (beim Wiederholen per `gh release edit`), und danach eine Gegenprobe gegen
   `releases/latest`: Zeigt sie auf den Edge-Tag, wird der Job rot. Die Markierung entscheidet,
   nicht die Reihenfolge der Tags.
7. **`workflow_dispatch`-Builds** (`staging-<sha>`) bekommen Stückliste und Attestation, aber
   kein Release. Die Stückliste liegt dort nur als Workflow-Artefakt `edge-sbom`.

## Konsequenzen

- **Advisory-Fall:** Stückliste eines Standes holen und durchsuchen:

  ```bash
  gh release download v26.x.y --repo panary/panary-core --pattern '*.cdx.json'
  jq -r '.components[] | select(.name=="<paket>") | "\(.name) \(.version) \(.purl)"' panary-edge-26.x.y.cdx.json
  ```

  Echtheit gegen das Image prüfen:

  ```bash
  gh attestation verify oci://ghcr.io/panary/panary-edge:26.x.y --owner panary \
    --predicate-type https://cyclonedx.org/bom
  ```

- Die Seite „Releases“ zeigt ab jetzt Edge-Releases neben den `pos-v*`-Releases. „Latest“ bleibt
  beim jüngsten POS-Release.
- **Ältere Tags** (`v26.9.13` und davor) haben keine Stückliste. Nachholen ginge per
  `workflow_dispatch` gegen deren Digest; das ist nicht Teil dieser Entscheidung.
- **arm64:** Heute wird nur `linux/amd64` gebaut ([ADR 0009](0009-edge-build-platforms.md)).
  Wird arm64 reaktiviert, braucht jede Plattform eine eigene Stückliste. syft löst eine
  Multi-Arch-Liste sonst auf die Plattform des Runners auf und verschweigt die andere.
- Zwei neue Lieferketten-Abhängigkeiten im Workflow (`anchore/sbom-action`, `actions/attest`,
  dazu `actions/download-artifact`), alle auf SHA gepinnt und älter als die 7-Tage-Karenz.
- Die Stückliste belegt den Inhalt des **gebauten** Images, nicht dass ein Edge es ausrollt;
  dafür bleibt `/health` → `version`. Ob ein gefundenes Paket ausnutzbar ist (VEX), bleibt offen.
- Die übrigen Teile von panary/panary-workbench#47 (u. a. panary/panary-core#421 und
  panary/panary-cloud#677) bauen auf dieser Entscheidung auf; cloud verweist auf dieses ADR,
  statt eine eigene zu führen.

## POS-Paket (`pos-v*`, core#421)

Das POS-Paket ist kein Image, sondern ein Tauri-Installer mit **zwei** Abhängigkeitsgraphen:
npm (Angular-Frontend, gebündelt) und Cargo (`apps/pos-client/src-tauri`). Punkt 1 (Format),
Punkt 3 (Plausibilitätsprüfung, kein `continue-on-error`) und Punkt 5 (öffentliches
Release-Asset) gelten unverändert. Abweichend gilt:

1. **Quelle sind die Lockfiles, mit denen der Windows-Job gebaut hat.** Einen Image-Scan gibt
   es nicht: Im Installer steckt ein kompiliertes Rust-Binary und ein Angular-Bundle, beide ohne
   Paket-Metadaten. Maßgeblich ist aber **nicht** das committete `pnpm-lock.yaml`:
   `release-pos.yml` löscht es und löst neu auf. Der Job `release-windows` legt deshalb nach dem
   Build `pnpm-lock.yaml` und `Cargo.lock` als Artefakt `pos-lockfiles` ab.
2. **Ein Werkzeug, eine Datei:** syft (`anchore/sbom-action/download-syft`, dieselbe Version wie
   beim Edge) liest beide Lockfiles in einem Lauf, beschränkt auf `javascript-lock-cataloger` und
   `rust-cargo-lock-cataloger`. Der Plan sah `cargo-cyclonedx` plus `cyclonedx-cli merge` vor.
   Verworfen, weil das zwei zusätzliche Werkzeuge und einen eigenen Fehlerpunkt (den Merge)
   bedeutet hätte, für dasselbe Ergebnis. Dateiname `panary-pos-<version>.cdx.json`.
3. **Eigener Job `release-sbom`** (`needs: release-windows`, nur `contents: write`). Er prüft auf
   `pkg:npm/`- und `pkg:cargo/`-Komponenten sowie namentlich auf `tauri`, `rumqttc`, `mdns-sd`
   und `@angular/core`, dann hängt er die Datei per `gh release upload` an. Genau ein Upload je
   Release: kein Wettlauf mit `release-macos`, und der Windows-Pfad bekommt nur einen letzten
   Schritt dazu. `--latest` bleibt unberührt, das `pos-v*`-Release **soll** Latest sein.
4. **Keine Attestation.** Es gibt keinen Digest, an den sie sich binden ließe; die
   Installer-Dateien sind selbst per minisign signiert.

Konsequenzen:

- 🚨 **Die npm-Seite ist eine Obermenge.** core ist ein Single-Package-Repo, das Lockfile kennt
  keinen POS-Ausschnitt. Die Stückliste listet deshalb auch Edge- und Build-Abhängigkeiten
  (gemessen am Stand von 2026-09-28: 2012 npm-Komponenten, darunter `better-sqlite3`, das nie ins
  POS-Bundle kommt; dazu 553 Cargo-Komponenten). Für „steckt X drin?“ ist das sicher, erzeugt aber
  Fehlalarme. Genauer wäre, was der Bundler einbindet (Angular-Build mit `--stats-json`);
  das ist nicht Teil dieser Entscheidung.
- Auch `Cargo.lock` listet Crates aller Zielplattformen, nicht nur Windows.
- Die Stückliste belegt den **Windows**-Build. `release-macos` löst sein Lockfile eigenständig
  neu auf und kann auf andere reife Versionen treffen; für das `.dmg` ist sie eine Näherung.
- Prüfen im Advisory-Fall wie beim Edge, nur mit `pos-v`-Tag:

  ```bash
  gh release download pos-v26.x.y --repo panary/panary-core --pattern '*.cdx.json'
  jq -r '.components[] | select(.name=="<paket>") | "\(.name) \(.version) \(.purl)"' panary-pos-26.x.y.cdx.json
  ```
