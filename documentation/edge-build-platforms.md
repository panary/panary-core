---
title: Edge-Docker-Build — Zielplattformen (amd64-only) & arm64-Re-Aktivierung
date: 2026-06-18
category: Infrastruktur
domains: [edge, ci]
status: aktiv
---

# Edge-Docker-Build — Zielplattformen

## Entscheidung (2026-06-18)

Das `panary-edge`-Docker-Image (Dockerfile `tools/docker/Dockerfile.edge`,
Workflow `.github/workflows/build-edge-docker.yml`) wird **nur noch für
`linux/amd64`** gebaut. Die zuvor zusätzlich gebaute `linux/arm64`-Variante
wurde entfernt.

## Begründung

- Der Edge läuft beim Testkunden auf einem **amd64-Linux-Server**. Das
  api-edge-Backend-Image wird derzeit **nirgends auf ARM** deployt — die
  Sunmi-POS-Geräte fahren den `pos-client` (Frontend via Capacitor), nicht
  dieses Backend-Image.
- Der `linux/arm64`-Build lief auf den amd64-GitHub-Runnern unter
  **QEMU-Emulation** (`docker/setup-qemu-action`). Emulierte Builds sind grob
  3–10× langsamer; `better-sqlite3` (natives Modul) plus die drei
  Angular-Production-Builds unter Emulation waren der mit Abstand größte
  Posten und Hauptursache des chronischen 30-/45-min-Timeout-Symptoms
  (siehe Memory `feedback_edge_docker_30min_timeout_flaky`).
- arm64 entfernen → QEMU entfällt komplett → Edge-Build grob halbiert.

## Konsequenzen

- `docker/setup-qemu-action` ist nicht mehr nötig und wurde aus dem Workflow
  entfernt.
- cosign-Signatur und SLSA-Provenance-Attestation sind unberührt (sie
  operieren auf dem resultierenden Single-Image-Digest).
- **Wer ein ARM-Edge-Ziel braucht (z. B. einen ARM-SBC als Edge), muss arm64
  wieder aktivieren — siehe unten.**

## arm64 wieder aktivieren — exakte Schritte

In `.github/workflows/build-edge-docker.yml`:

1. Im `Build and Push`-Step das `platforms:`-Feld zurücksetzen:
   ```yaml
   platforms: linux/amd64,linux/arm64
   ```
2. Den QEMU-Setup-Step wieder **vor** dem `Login to GHCR`-Step einfügen
   (er registriert die binfmt-Handler für die Emulation):
   ```yaml
   - name: Set up QEMU (Multi-Platform)
     uses: docker/setup-qemu-action@v4
   ```
3. Optional `timeout-minutes` wieder erhöhen (Emulation ist langsam; vor der
   Umstellung stand der Cap auf 45).

Die exakt gleiche Anleitung steht als Inline-Kommentar direkt am
`platforms:`-Feld im Workflow.

### Schnellere Alternative ohne QEMU (empfohlen, falls arm64 dauerhaft nötig)

Statt QEMU-Emulation arm64 **nativ** bauen:

- Einen zweiten Job bzw. Matrix-Eintrag mit `runs-on: ubuntu-24.04-arm`
  (nativer ARM-Runner) für `linux/arm64`, amd64 weiter auf `ubuntu-latest`.
- Beide Images per Digest pushen und per
  `docker buildx imagetools create -t <tag> <amd64-digest> <arm64-digest>`
  zur Multi-Arch-Manifest-Liste zusammenführen.

Das eliminiert die Emulationskosten vollständig.

## Verwandt

- `feedback_edge_docker_30min_timeout_flaky` (Memory) — das Timeout-Symptom,
  dessen Hauptursache (cache-los + QEMU-arm64) hiermit adressiert ist.
- Gleichzeitig ergänzt (2026-06-18): GHA-Layer-Cache (`cache-to`) +
  pnpm-Store-Cache-Mount im Edge-Build.
