---
type: Guide
title: Edge-Installation — GHCR-Pull-Fehler „denied: denied"
description: Der Installer bricht mit „denied: denied" ab, obwohl das Edge-Image öffentlich ist — Ursache sind abgelaufene lokale ghcr.io-Credentials, erkannt durch die Registry-Vorabprüfung in install.sh.
tags: [api-edge, docker, infra, deployment]
status: stable
generated: { by: claude-code/opus-5, at: 2026-07-27T16:08:22Z }
sources:
  - { id: install-sh, resource: tools/hosting/get.panary.io/install.sh, title: Edge-Installationsskript }
  - { id: build-workflow, resource: .github/workflows/build-edge-docker.yml, title: Build Edge Docker (GHCR-Push) }
---

# Edge-Installation: GHCR-Pull-Fehler „denied: denied"

## Symptom

Beim Aufsetzen eines weiteren Edge-Servers scheitert der Installer am Image-Pull:

```
→ Image pullen: ghcr.io/panary/panary-edge:latest
 ✘ Image ghcr.io/panary/panary-edge:latest  Error Head "https://ghcr.io/v2/panary/panary-edge/manifests/latest": denied: denied
```

Erstmals beobachtet am 2026-07-27 bei einer Zweitinstallation (Host `cpc-buero`).

## Ursache

**Nicht** die Paket-Sichtbarkeit. Das Paket `ghcr.io/panary/panary-edge` ist öffentlich —
ein anonymer Manifest-Request beantwortet GHCR mit `HTTP 200`, ohne jede Credential:

```bash
TOKEN=$(curl -s "https://ghcr.io/token?scope=repository:panary/panary-edge:pull&service=ghcr.io" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -s -o /dev/null -w '%{http_code}\n' -I -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/vnd.oci.image.index.v1+json' \
  https://ghcr.io/v2/panary/panary-edge/manifests/latest
```

Die Ursache liegt im Client: Sobald in der Docker-Config (`~/.docker/config.json`) ein
Eintrag für `ghcr.io` steht — typischerweise ein abgelaufener PAT oder ein defekter
Credential-Helper — schickt Docker diesen Token mit. GHCR antwortet dann mit `denied`,
**statt** auf den anonymen Pfad zurückzufallen. Ohne jede Credential läuft derselbe Pull
durch.

Fallstrick bei der Suche nach der richtigen Config-Datei: `install.sh` pullt per
`su "$REAL_USER"`, also mit dem Home des aufrufenden Users — **nicht** mit dem von root,
obwohl das Skript unter `sudo` läuft. Beide Pfade prüfen.

## Behebung

```bash
docker logout ghcr.io        # als der User, dem der Installer gehört
sudo docker logout ghcr.io   # zusätzlich als root
```

Danach `install.sh` erneut ausführen — das Skript ist idempotent und behält die bestehende
`.env` samt `FEATHERS_SECRET`.

## Registry-Vorabprüfung im Installer

`tools/hosting/get.panary.io/install.sh` prüft seit 2026-07-27 vor jedem Schreibzugriff die
Registry — bewusst per `curl` **an der Docker-Config vorbei**, damit die Frage „Paket/Netz
oder lokaler Login?" schon vor dem Pull beantwortet ist:

| HTTP | Bedeutung | Verhalten |
|---|---|---|
| `200` | Image öffentlich erreichbar | Weiter; zusätzlich Warnung, falls ein ghcr.io-Login existiert |
| `404` | Tag existiert nicht (z. B. Tippfehler in `--tag`) | Abbruch mit Link auf die Tag-Liste |
| `401`/`403` ohne Login | Paket nicht öffentlich | Abbruch mit `docker login`-Anleitung |
| `401`/`403` mit Login | Zugriff läuft über den vorhandenen Login | Warnung, weiter |
| `000` | Registry nicht erreichbar (Proxy/DNS/Firewall) | Warnung, weiter |

Zusätzlich meldet der Installer gefundene `ghcr.io`-Einträge in den Docker-Configs von
aufrufendem User und root. Schlägt der Pull trotz `HTTP 200` fehl, gibt der Fehlerpfad
direkt die `docker logout`-Kommandos und die betroffenen Config-Dateien aus.

## Kein GitHub-Token nötig

Das Image wird von [`build-edge-docker.yml`](../../.github/workflows/build-edge-docker.yml)
bei jedem `v*`-Tag nach `ghcr.io/<owner>/panary-edge` gepusht und ist öffentlich lesbar. Für
die Installation braucht es **keinen** Personal Access Token. Ein `docker login ghcr.io` ist
nur nötig, falls die Paket-Sichtbarkeit künftig auf privat gestellt wird — dann meldet die
Vorabprüfung `401`/`403` und bricht mit der passenden Anleitung ab.

Siehe auch: [Docker-Build-Fix — Native Module](docker-native-module-fix.md).
