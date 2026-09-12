---
type: ADR
title: MQTT-Publish im Rust-Prozess statt im Webview
description: Der POS publiziert Druckaufträge für MQTT-Drucker über einen Tauri-Command statt über mqtt.js im Webview, weil die statische CSP eine Betreiber-Konfiguration nicht abdecken kann.
tags: [orders, locations, print-server, mqtt, pos-client]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-09-12T21:30:00.000Z }
---

# MQTT-Publish im Rust-Prozess statt im Webview

## Problem

Drucker mit `type: 'mqtt'` sind ein reiner Client-Pfad: Der POS verbindet sich
selbst zum Broker und publiziert fire-and-forget auf das Topic des Druckers. Das
Edge-Backend spricht kein MQTT.

Solange dieser Publish im Webview liegt, unterliegt er der
`connect-src`-Direktive aus `apps/pos-client/src-tauri/tauri.conf.json`. Die ist
**statisch** — sie steht im gepackten Artefakt. Das Ziel dagegen ist
**Betreiber-Konfiguration**: `printSettings.mqttServerProtocol` (`ws`/`wss`),
`mqttServerUrl` (beliebiger Host) und `mqttServerPort` (laut
`location.schema.ts` 1–65535).

Beides ist nicht in Deckung zu bringen. Genau daran ist der Pfad gescheitert:
`connect-src` kannte an WebSockets nur `ws://*:3030` (den Edge), der
mitgelieferte Broker lauscht aber auf **9001** ([ADR 0018](0018-mqtt-broker-im-edge-deployment.md)).
`9001` stand in keiner Version der Datei — MQTT-Druck aus einem **gepackten** POS
hat seit `pos-v26.4.10` nie funktioniert
([#296](https://github.com/panary/panary-core/issues/296)).

Verschärfend kommt hinzu, dass der Fehler im Dev-Modus unsichtbar ist: Tauri
setzt den CSP-Header ausschließlich im `tauri://`-Asset-Handler
(`protocol/tauri.rs`); unter `#[cfg(dev)]` liefert `AppManager::get_app_url()`
die `devUrl` und der Webview navigiert direkt auf `http://localhost:4200` — dort
gibt es **gar keine CSP**. Lokal ging jeder Druck, beim Betreiber keiner.

#296 hat das mit den Schema-Quellen `ws:`/`wss:` sofortbehoben. Das war bewusst
die breite Variante und als Übergang gedacht: Eine Schema-Quelle ist keine
Direktive mehr, sondern deren Abschaltung für dieses Schema.

## Entscheidung

**Der MQTT-Publish verlässt den Webview.** Im gepackten POS läuft er über den
Tauri-Command `mqtt_publish` im Rust-Prozess (`rumqttc`), wo keine CSP gilt.
`connect-src` ist damit wieder auf die Ziele eingeengt, die der Webview
tatsächlich anspricht — Edge auf 3030, Cloud, GitHub-Updater.

**Der Transport bleibt MQTT-over-WebSocket.** Der Command spricht dieselben
`ws`/`wss`-Adressen wie zuvor `mqtt.js`, auf demselben Port aus denselben
Settings. Die Alternative — MQTT/TCP auf 1883, wie der Broker es ohnehin
anbietet — hätte ein zusätzliches Schema-Feld verlangt: `mqttServerPort` zeigt
bei jeder Bestandsinstallation auf den WebSocket-Port, und eine stille
Umdeutung bricht jede manuell gepflegte Broker-Konfiguration. Das Feld hätte
`location.schema.ts`, die Drucker-UI in **beiden** Repos (`admin-client` und
`panary-cloud/libs/domains/settings/feature-admin`), die Import/Export-Dialoge
und einen Pin-Bump berührt. Der Preis stand in keinem Verhältnis: Der WS-Weg
erreicht dasselbe Ziel, ohne eine einzige Bestandskonfiguration anzufassen.

**Die URL baut der Aufrufer.** `buildBrokerUrl` in `mqtt-publish.ts` ist der
einzige Bauort für beide Wege. Zwei wären zwei Gelegenheiten, dass Rückfall und
Regelweg auf verschiedene Adressen zeigen — dieselbe Klasse Fehler wie beim
Ziel-Host des HTTP-Drucks (`resolveEdgeBaseUrl`, #105).

**Der Webview-Weg bleibt als Rückfall.** Ohne Tauri (Browser, `nx serve`,
Edge-Admin) publiziert weiterhin `mqtt.js`. Ohne ihn verlöre genau die Umgebung
den MQTT-Druck, in der er sich testen lässt.

**Ein Gate bewacht die Direktive.** `pnpm csp:gate`
(`scripts/csp-connect-src.mjs`) prüft `connect-src` in beide Richtungen: Kein
gebrauchtes Ziel darf herausfallen, keine Pauschal-Quelle zurückkehren, und der
Broker-Port darf **nicht** wieder gedeckt sein.

## Konsequenzen

- **Der Betreiber muss nichts tun.** Protokoll, Host und Port gelten unverändert
  weiter; es gibt kein neues Feld, keine Migration und keinen Eingriff in
  Bestandsinstallationen.
- **Der Broker braucht weiterhin seinen WebSocket-Listener auf 9001.** Der
  ursprüngliche Nebengedanke, ihn mit dem Umzug entbehrlich zu machen, ist
  bewusst nicht eingelöst — er wäre nur mit der Schema-Änderung oben zu haben.
- **Neue Abhängigkeit `rumqttc`** (Feature `websocket`, ohne `url`). Netto
  **+30 Crates** im POS-Baum (295 → 325, `cargo tree` am 2026-09-12): Der
  WebSocket- und TLS-Unterbau kommt fast vollständig aus dem, was Tauri über
  `reqwest`/`rustls`/`tokio` ohnehin mitbringt. Isoliert gemessen wäre `rumqttc`
  mit `websocket` bei 108–122 Crates gelandet — diese Zahl beschreibt den
  POS-Fall nicht.
- **`MqttOptions::parse_url` ist hier die falsche API** und wird nicht benutzt:
  `TryFrom<Url>` übernimmt nur Host, Port und Query und **verwirft den Pfad**,
  während `Transport::Ws` die vollständige URL in `broker_addr` erwartet
  (rumqttc `eventloop.rs`: „domain and port are taken directly from
  `broker_addr` (which is a url)"). Mit `parse_url` ginge `/mqtt` still
  verloren.
- **Der Command ist eine Fähigkeit, die die CSP umgeht** — das ist sein Zweck
  und zugleich seine Angriffsfläche. Er ist deshalb auf `ws://`/`wss://`
  begrenzt und weist jedes andere Schema ab. Eine Prüfung von Host und Port
  gegen die geladenen Settings findet **nicht** statt: Die Settings liegen im
  Webview, nicht im Rust-Prozess. Ein kompromittierter Webview kann über den
  Command also einen beliebigen MQTT-Broker ansprechen. Das ist gegenüber dem
  Zustand vor #296 eine echte Ausweitung und gegenüber dem Sofortfix aus #296
  (`ws:`/`wss:` für alles) eine Einengung.
- **Tauri-Capabilities sind unbeteiligt.** Eigene App-Commands aus
  `tauri::generate_handler!` unterliegen nicht dem Permission-System; ein
  Eintrag in `capabilities/default.json` wäre wirkungslos. Dasselbe gilt für
  `discover_panary_hubs`, `js_log`, `read_logs` und `open_log_dir`.
- **Die CI baut kein Rust.** Der Command ist damit in keinem CI-Lauf kompiliert;
  `cargo check --locked` gehört lokal vor jeden PR, der `src-tauri/` anfasst.
- **Der Fix wirkt erst über einen `pos-v*`-Build.** Ein Edge-Release ändert am
  Gerät nichts.

Verwandt: [ADR 0018](0018-mqtt-broker-im-edge-deployment.md),
[Print-Server-API](../integrations/print-server-api.md).
