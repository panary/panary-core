---
type: Guide
title: Edge startet nicht — FEATHERS_SECRET fehlt oder ist der Platzhalter
description: Seit der Boot-Härtung bricht der Edge ab, statt JWTs mit dem Platzhalter aus dem öffentlichen Repo zu signieren; dieser Guide nennt Meldung, Ursachen und den Weg zurück in den Betrieb.
tags: [api-edge, security, boot, infra, deployment]
status: stable
generated: { by: claude-code/opus-5, at: 2026-09-17T12:20:00.000Z }
sources:
  - { id: adr-0040, resource: docs/adr/0040-edge-boot-haertung-secret-und-config-allowlist.md, title: ADR 0040 — Edge-Boot-Härtung }
  - { id: install-sh, resource: tools/hosting/get.panary.cloud/install.sh, title: Edge-Installationsskript }
  - { id: boot-guards, resource: apps/api-edge/src/utils/boot-guards.ts, title: Boot-Schutzschichten }
---

# Edge startet nicht — `FEATHERS_SECRET`

## Symptom

Der Container läuft an und beendet sich sofort wieder; die Restart-Policy startet ihn in
wachsenden Abständen neu. Im Log steht **eine** Zeile mit der Ursache:

```
Fatal error during startup: FEATHERS_SECRET ist nicht gesetzt — der Edge startet ohne
JWT-Signaturschlüssel nicht. Behebung: FEATHERS_SECRET in der .env des Edge setzen
(z. B. `openssl rand -base64 32`) und den Container neu starten. Der Installer
get.panary.cloud erzeugt den Wert bei der Erstinstallation.
```

Zwei weitere Varianten derselben Prüfung:

| Meldung enthält | Bedeutung |
| --- | --- |
| `ist nicht gesetzt` | Umgebungsvariable fehlt oder ist leer |
| `entspricht dem Platzhalter` | Der Wert ist `CHANGE_ME_IN_PRODUCTION` aus dem öffentlichen Repo |
| `ist zu kurz` | Unter 32 Zeichen |

```bash
docker logs panary-edge 2>&1 | grep -i feathers_secret
```

## Warum der Edge dabei stehenbleibt

Ein Edge, der mit dem Platzhalter signiert, akzeptiert JWTs, die **jeder** ausstellen kann —
der Wert steht im öffentlichen Repository. Vor der Härtung
([ADR 0040](../adr/0040-edge-boot-haertung-secret-und-config-allowlist.md)) startete er
in diesem Zustand klaglos. Ein stehender Edge fällt auf; ein still kompromittierter nicht.

## Behebung

Der reguläre Weg ist ein erneuter Lauf des Installers — er ist idempotent und erzeugt das
Secret nach, wenn die bestehende `.env` es leer, als Platzhalter oder zu kurz trägt:

```bash
curl -fsSL https://get.panary.cloud | sudo bash
```

Von Hand, wenn der Installer nicht in Frage kommt:

```bash
cd /opt/panary-edge                      # Installationsverzeichnis
openssl rand -base64 32                  # Wert erzeugen
sudo sed -i 's#^FEATHERS_SECRET=.*#FEATHERS_SECRET=<erzeugter-wert>#' .env
sudo docker compose up -d
```

🚨 **Ein neues Secret entwertet alle bestehenden Edge-JWTs.** Angemeldete Sitzungen am
Admin-Panel und an den POS-Geräten enden einmalig; die Geräte melden sich über ihren
API-Key neu an. Das ist der Preis und kein Fehler — er fällt einmalig an, nicht bei jedem
Neustart.

## Wer davon betroffen sein kann

- **Über `get.panary.cloud` installierte Edges: in aller Regel nicht.** Der Installer erzeugt
  das Secret seit jeher bei der Erstinstallation und behält es bei jedem weiteren Lauf.
- **Von Hand aufgesetzte Container** (`docker run` ohne `-e FEATHERS_SECRET`, eigenes Compose)
  liefen bis hierher auf dem Platzhalter und starten nach dem Update nicht mehr.
- **`tools/docker/docker-compose.edge.yml`** (Prod-Test im Repo) reichte das Secret früher
  nicht durch und verlangt es jetzt ausdrücklich — ohne gesetzten Wert scheitert bereits
  `docker compose up`, nicht erst der Container.
- **Lokale Entwicklung:** `apps/api-edge/.env` mit `FEATHERS_SECRET=…` anlegen (gitignored);
  Nx lädt sie für `nx serve api-edge`. Die Testsuite bringt ihren eigenen Wert mit
  (`apps/api-edge/vitest.config.mts`, `test.env`).

## Angrenzend: Kein Setup-Modus mehr bei Boot-Fehlern

Dieselbe Härtung hat den Setup-Modus als Auffangnetz entfernt. Führte früher **jeder**
Boot-Fehler dazu, dass der Edge einen unauthentifizierten Setup-Endpunkt im LAN öffnete,
gilt jetzt: Nur eine **fehlende** `data/panary.config.json` startet den Setup-Modus. Bei
kaputtem JSON oder einem Fehler in Migration, DB oder Service-Start beendet sich der Prozess
mit `exit(1)`:

```
Boot fehlgeschlagen bei vorhandener Konfiguration (…/data/panary.config.json).
Der Edge startet NICHT.
```

Wer vor Ort früher den Setup-Bildschirm zur Diagnose benutzt hat, findet die Ursache jetzt
im Container-Log. Das ist beabsichtigt: Ein kaputter Edge soll stehenbleiben, nicht sich
anbieten.

Der Setup-Modus selbst ist inzwischen ebenfalls nicht mehr offen: Er verlangt ein Token aus
dem Container-Log — siehe
[Edge einrichten — das Setup-Token](../guides/edge-ersteinrichtung-setup-token.md).
