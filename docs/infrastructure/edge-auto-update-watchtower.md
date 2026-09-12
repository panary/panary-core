---
type: Guide
title: Edge-Auto-Update — Watchtower spricht eine zu alte Docker-API
description: Watchtower crasht auf Docker-Engines ab Version 25 beim Start und aktualisiert den Edge nie wieder; DOCKER_API_VERSION=1.41 behebt es, ein Image-Pull nicht.
tags: [api-edge, docker, infra, deployment, watchtower]
status: stable
generated: { by: claude-code/opus-5, at: 2026-09-12T11:05:00Z }
sources:
  - { id: install-sh, resource: tools/hosting/get.panary.cloud/install.sh, title: Edge-Installationsskript }
  - { id: adr-0018, resource: docs/adr/0018-mqtt-broker-im-edge-deployment.md, title: ADR 0018 — Bestandsinstallationen und docker-compose.yml }
---

# Edge-Auto-Update: Watchtower spricht eine zu alte Docker-API

## Symptom

Der Edge läuft, aber seine Version bleibt über Wochen stehen, obwohl längst neuere
Releases getaggt sind. `docker ps` zeigt den Grund:

```
0b9e1215b3a6  containrrr/watchtower  "/watchtower"  4 weeks ago  Restarting (1) 39 seconds ago
```

Und die Logs eine Zeile, die sich im Minutentakt wiederholt:

```
level=error msg="Error response from daemon: client version 1.25 is too old.
  Minimum supported API version is 1.40, please upgrade your client to a newer version"
```

Am 2026-09-12 auf zwei Installationen gefunden: eine stand **38 Tage** auf v26.8.6, die
andere **31 Tage** auf v26.8.17, während rund 30 Releases erschienen. Aufgefallen ist es
nur, weil ein längst behobener Bug (#183) auf einem der Geräte noch auftrat.

## Ursache

Das Watchtower-Image ist eingestellt. `containrrr/watchtower:latest` und
`containrrr/watchtower:1.7.1` tragen **denselben Digest**
(`sha256:f9086bfda061100361fc2bacf069585678d760d705cf390918ccdbda8a00980b`), die
Image-Config nennt als Erstellungsdatum **2023-11-11**; 1.7.1 ist der höchste Versions-Tag
im Repository. Der darin einkompilierte Docker-Client spricht API **1.25**. Docker-Engines
ab Version 25 haben die minimal unterstützte API auf **1.40** angehoben — der Container
beendet sich deshalb beim **Start** mit Exit 1, und `restart: unless-stopped` startet ihn
im Minutentakt neu.

🚨 **Ein `docker compose pull` heilt das nicht.** `latest` *ist* bereits die letzte
Version. Das Image sieht aktuell aus und ist trotzdem tot — genau deshalb blieb der
Ausfall wochenlang unbemerkt.

Der Crash passiert beim Start, nicht beim ersten Poll: Ein frisch reparierter Watchtower
meldet dagegen `Scheduling first run: … in 59 minutes, 59 seconds` und wartet.

## Behebung

`DOCKER_API_VERSION` in die Watchtower-Umgebung. Seit diesem Fix schreibt `install.sh` sie
mit; Bestandsinstallationen tragen sie von Hand nach:

```yaml
  watchtower:
    image: containrrr/watchtower:1.7.1
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_POLL_INTERVAL=3600
      - WATCHTOWER_SCOPE=panary
      - DOCKER_API_VERSION=1.41
```

```bash
cd /opt/panary && docker compose up -d watchtower && docker logs --tail 20 panary-watchtower
```

Erwartet wird `Scheduling first run: …` statt `client version 1.25 is too old`.

**Warum 1.41 und nicht höher:** Watchtower braucht keine neuen API-Features. 1.41 liegt
über der geforderten 1.40 und wird von jeder Engine ab Docker 20.10 unterstützt — der Wert
trägt damit auch auf älteren Hosts. Den Spielraum der eigenen Engine zeigt:

```bash
docker version --format '{{.Server.APIVersion}} (min {{.Server.MinAPIVersion}})'
```

**Warum die Version gepinnt ist:** Ein unangepinntes `latest` auf einem eingestellten
Upstream ist kein Update-Kanal, sondern eine offene Flanke — es kann nur noch durch eine
Übernahme des Repositories wachsen.

Gemessen wurde beides gegen `containrrr/watchtower:1.7.1`: mit `DOCKER_API_VERSION=1.99`
antwortet der Daemon `client version 1.99 is too new`, die Variable wird also gelesen; mit
`1.41` läuft der Lauf sauber durch (`Session done, Failed=0`).

## Reihenfolge auf einem Produktivsystem

🚨 **Erst das kontrollierte Update, dann Watchtower.** Ein reparierter Watchtower zieht
binnen einer Stunde `latest` — mitten im Betrieb, samt aller aufgestauten Migrationen. Beim
Sprung über `20260813210000_orders_drop_legacy_discount` ist das irreversibel: Die Migration
droppt `orders.discount`, ihr `down()` legt die Spalte leer wieder an. Der Bestand gehört
vorher erkannt (Query in [Rabatte](../domains/rabatte.md#erkennung-von-bestands-orders)),
und ein Backup von `${INSTALL_DIR}/data` davor.

## Warum es niemandem auffiel

Der Installer prüfte nach `docker compose up -d` nur den Edge-Healthcheck. Der ist grün,
während der Update-Kanal tot ist — die Anwendung läuft ja. Seit diesem Fix prüft
`install.sh` zusätzlich den Watchtower und sagt beim Ausfall ausdrücklich, dass der Edge
dauerhaft auf der installierten Version bleibt.

Gemessen wird dabei der **Restart-Zuwachs** über acht Sekunden, nicht der Momentzustand.
Das ist keine Feinheit: Ein crashender Watchtower steht in den ersten Sekunden selbst auf
`running`, weil Dockers Restart-Backoff bei 100 ms beginnt und der Container zwischen zwei
Abstürzen ständig kurz läuft. Erst nach rund zehn Sekunden steht dauerhaft `restarting` da.
Die erste Fassung dieser Prüfung las den Momentzustand und meldete in diesem Fenster
**grün auf einen toten Watchtower** — aufgefallen erst im Test gegen einen künstlich
kaputten Container. Der Zuwachs ist zudem unabhängig vom Startwert: Ein Bestandscontainer,
den `docker compose up -d` unverändert stehen lässt, bringt seinen alten `RestartCount`
mit, und eine absolute Prüfung wäre dort ein Fehlalarm.

Was diese Prüfung **nicht** leistet: Sie greift nur beim Installationslauf. Stirbt
Watchtower später — etwa weil ein Host-Upgrade die Engine-Mindest-API anhebt —, meldet das
niemand. Ein Edge, dessen Version stillsteht, fällt weiterhin nur auf, wenn jemand
hinsieht.

## Bestandsinstallationen erreicht das nicht von allein

Watchtower aktualisiert Images, **nicht** die `docker-compose.yml` (siehe
[ADR 0018](../adr/0018-mqtt-broker-im-edge-deployment.md)). Ein Bestandssystem bekommt die
korrigierte Watchtower-Definition also weder über einen Release-Tag noch über den
Auto-Update-Kanal — und im Fehlerfall ohnehin nicht, weil genau dieser Kanal ja tot ist.
Nötig ist ein erneuter Lauf des `install.sh`-Einzeilers (idempotent, behält `.env` samt
`FEATHERS_SECRET`) oder das Nachtragen der Zeile von Hand.
