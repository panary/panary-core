---
type: ADR
title: MQTT-Broker als Teil des Edge-Deployments — Mosquitto neben dem Edge statt Handarbeit in der Filiale
description: Der Print-Server-Transport bekommt einen mitgelieferten Mosquitto im Host-Netz des Edge; der POS löst den Broker-Host still über den gepairten Edge auf, statt sich auf den localhost-Default der Print-Settings zu verlassen.
tags: [print-server, mqtt, infra, api-edge, pos-client, locations]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-04T15:43:00.000Z }
---

# MQTT-Broker als Teil des Edge-Deployments

## Problem

Der Druckpfad kennt zwei Sorten Drucker (`printSettings.printers[].type`): `ip` und `mqtt`.
Der IP-Zweig läuft serverseitig über `/print-server/print-order` am Edge. Der MQTT-Zweig
läuft ausschließlich im Client — `OrderPrintService.printViaMqtt` verbindet sich per
MQTT-over-WebSocket zu einem Broker und publiziert dorthin fire-and-forget; das Edge-Backend
spricht selbst kein MQTT (`print-job.builder.ts` bedient bewusst nur IP-Drucker).

Diesen Broker hat nie jemand ausgeliefert. `install.sh` erzeugte einen Edge und einen
Watchtower, sonst nichts. Wer MQTT-Drucker einsetzen wollte, musste in der Filiale von Hand
einen Broker aufsetzen — oder es fiel schlicht niemandem auf, dass der Zweig ohne Gegenstelle
ins Leere lief.

Der zweite Teil des Problems liegt in den Defaults. `generateDefaultLocationSettings` setzt
`mqttServerUrl: 'localhost'`. Gemeint war „der Rechner, auf dem alles läuft" — richtig,
solange POS und Broker dieselbe Maschine sind. Auf einem Sunmi-Tablet ist `localhost` das
Tablet. Der Publish lief damit in einen Verbindungsfehler, den niemand zu sehen bekam,
während die Einstellung in der Admin-UI vollständig ausgefüllt aussah. Das ist dieselbe
Fehlerklasse wie der Bon-Druck an die eigene Herkunft (siehe
[Print-Server-API](../integrations/print-server-api.md)) — ein Ziel-Host, der im
Entwicklungsaufbau stimmt und im Feld auf das falsche Gerät zeigt.

## Entscheidung

**Mosquitto wird Teil des Edge-Deployments.** `install.sh` generiert einen zusätzlichen
Service `panary-mqtt` (`eclipse-mosquitto:2`) in die `docker-compose.yml` beim Kunden;
`tools/docker/docker-compose.edge.yml` führt denselben Service, damit der Prod-Test nicht
von der ausgelieferten Konstellation abweicht.

**Host-Networking, wie beim Edge.** Der Broker lauscht damit direkt auf der LAN-IP des
Hosts — kein Port-Mapping, kein NAT, und vor allem keine IP, die in der Installation
eingetragen werden müsste. Der Edge braucht Host-Mode ohnehin zwingend für die
mDNS-Annonce; ein zweites Netzwerkmodell im selben Deployment wäre reine Zusatzkomplexität.

**Zustandslos.** `persistence false`, kein Volume. Der POS publiziert mit `clean: true` und
QoS 0 (`mqtt-publish.ts`) — es gibt weder Retained Messages noch Offline-Queues, die einen
Neustart überleben müssten.

**Konfiguration inline.** Die `mosquitto.conf` liegt als `configs: content:`-Eintrag im
Compose, damit die Installation bei einer einzigen generierten Datei bleibt. Das kann erst
Compose 2.23.1+, deshalb prüft `install.sh` die Fähigkeit vorab — über einen echten
`config`-Lauf gegen stdin statt über die Versionsnummer, die je nach Distribution Suffixe
wie `-desktop.1` trägt.

**Der Client löst den Broker-Host selbst auf.** `resolveMqttBrokerHost`
(`libs/domains/orders/data-access/src/lib/utils/mqtt-broker-host.ts`) fällt bei leerem oder
selbstbezüglichem Eintrag (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`) still auf den Host des
gepairten Edge zurück. Still, weil der Betreiber nichts falsch gemacht hat — der Default war
falsch. Ein explizit gepflegter, nicht selbstbezüglicher Host gewinnt weiterhin immer.
Aufgelöst wird bewusst nur der Host; Protokoll und Port bleiben in den Settings, damit eine
abweichende Broker-Installation konfigurierbar bleibt.

### Verworfene Alternativen

* **Broker in der Cloud.** Scheidet aus: Drucken muss offline funktionieren. Ein Broker
  jenseits der Internetleitung macht den Bon von der WAN-Verfügbarkeit abhängig — das
  Gegenteil des Offline-First-Versprechens.
* **Bridge-Netz mit `ports:`-Mapping.** Funktioniert, kauft aber nichts: Isolation gegen den
  Host ist keine ernstzunehmende Grenze, solange der Broker anonym im selben LAN erreichbar
  ist. Dafür stünden zwei Netzwerkmodelle nebeneinander.
* **Separate `mosquitto.conf` neben der Compose-Datei.** Wäre kompatibel mit älteren
  Compose-Versionen, bringt aber eine zweite generierte Datei in die Installation, die beim
  Update mitwandern muss.

## Konsequenzen

* **Bestandsinstallationen bekommen den Broker nicht automatisch.** Watchtower aktualisiert
  Images, nicht die `docker-compose.yml`. Der Rollout-Schritt ist das erneute Ausführen des
  `install.sh`-Einzeilers — nicht der Release-Tag. Das ist die wichtigste Konsequenz und die
  am leichtesten zu übersehende.
* **Compose 2.23.1+ ist ab jetzt Installationsvoraussetzung.** Ältere Plugins bricht der
  Pre-Flight-Check mit klarer Ansage ab, statt sie später an einem Parse-Fehler scheitern zu
  lassen. Auf Distributionen mit altem `docker-compose-plugin` ist das ein zusätzlicher
  Update-Schritt vor der Installation.
* **1883 und 9001 sind auf dem Edge-Host belegt.** Läuft dort bereits ein Broker aus einer
  Paketinstallation, startet der Container nicht. Im Host-Mode lässt sich das nicht per
  Port-Mapping umbiegen — nur über die Listener in der Config.
* **Der Broker läuft ohne Authentifizierung** (`allow_anonymous true`) auf allen Interfaces.
  Das ist die bewusste Annahme „geschlossenes Filialnetz": jedes Gerät im LAN kann Druckjobs
  einschleusen und mitlesen. Hängt ein Edge an einer öffentlichen IP, braucht er eine
  `password_file` oder einen an das interne Interface gebundenen Listener.
* **`persistence false` gilt nur, solange kein Subscriber Zustellgarantien braucht.** Ein
  künftiger Print-Bridge-Dienst, der Jobs mit QoS 1 über einen Neustart hinweg nachgeliefert
  bekommen soll, kippt diese Entscheidung und braucht wieder ein Volume.
* **Zwei Compose-Dateien müssen deckungsgleich bleiben** — die generierte beim Kunden und
  `tools/docker/docker-compose.edge.yml`. Driftet eine, testet der Prod-Test eine
  Konstellation, die es im Feld nicht gibt. Ein Gate dagegen gibt es nicht, nur diesen Hinweis
  und den Kommentar an beiden Services.
* **`docker-compose.edge.dev.yml` bleibt bewusst ohne Broker.** Im Host-Mode kollidierte ein
  zweiter Broker hart auf 1883/9001; der Dev-Edge nutzt den des Prod-Stacks mit.
