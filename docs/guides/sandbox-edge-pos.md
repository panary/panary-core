---
type: Guide
title: Sandbox — Edge und POS auf eigenen Ports, Pairing ohne Handarbeit
description: Wie api-edge, Admin-Client und POS-Client neben dem eigenen Dev-Stack auf den Sandbox-Ports laufen, wie der Edge per Skript an die Sandbox-Cloud und der POS per Pairing-Code an den Edge gekoppelt wird und was dabei am Edge ankommt.
tags: [sandbox, sichttest, dev-setup, pos, pairing, sync]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-13T21:40:00Z }
sources:
  - { id: issue-691, resource: 'https://github.com/panary/panary-core/issues/691', title: 'Sandbox: Edge und POS auf versetzten Ports, Test-PINs am Edge' }
  - { id: cloud-1140, resource: 'https://github.com/panary/panary-cloud/issues/1140', title: 'Sandbox-Seed (Cloud-Teil)' }
  - { id: cloud-1142, resource: 'https://github.com/panary/panary-cloud/issues/1142', title: 'Seed-Kennzeichnung nicht an den Edge synchronisieren' }
  - { id: workbench-170, resource: 'https://github.com/panary/panary-workbench/issues/170', title: 'Sandbox für automatisierte Sichttests' }
---

# Sandbox — Edge und POS

Die Sandbox ist eine lokale Wegwerf-Umgebung für Sichttests ohne Handarbeit: Cloud, Edge, Admin-Client
und POS laufen gekoppelt neben dem eigenen Dev-Stack. Den Cloud-Teil beschreibt
`panary-cloud/docs/guides/sandbox-seed.md`, die Orchestrierung (`scripts/sandbox.sh`) liegt im Workbench
(panary/panary-workbench#170). Dieses Dokument beschreibt, was core dafür bereitstellt.

## Ports

| Dienst       | Port  | Woher                                                                                     |
| ------------ | ----- | ----------------------------------------------------------------------------------------- |
| api-edge     | 13030 | `PORT=13030`, `EDGE_ORIGINS='["http://localhost:13030","http://localhost:14200"]'`        |
| Admin-Client | 13030 | vom Edge selbst unter `/admin` ausgeliefert (`dist/apps/admin-client/browser`, gleicher Origin) |
| POS-Client   | 14200 | `nx serve pos-client --configuration=sandbox`                                             |

- **`EDGE_ORIGINS`** (JSON-Liste, `config/custom-environment-variables.json`) ersetzt die CORS-Origins
  ganz, wie `CLOUD_ORIGINS` in der Cloud. Ohne die Variable gilt `config/default.json` unverändert.
- **POS `sandbox`:** Die Konfiguration tauscht per `fileReplacements` `src/app/edge-url.ts` gegen
  `edge-url.sandbox.ts` (`http://localhost:13030`). Das ist nur die Adresse **vor** der Kopplung; danach
  gilt `serverUrl` aus der Gerätekonfiguration. Produktions- und Tauri-Build bleiben unberührt.
- Der Admin-Client braucht keine eigene Konfiguration: Unter `/admin/` leitet er die API-Adresse aus dem
  eigenen Origin ab (`resolveApiUrl`). Er muss nur einmal gebaut sein (`nx build admin-client`).

Weitere Edge-Variablen für die Sandbox: `FEATHERS_SECRET`, `EDGE_TOKEN_ENCRYPTION_KEY`,
`SQLITE_PATH` und `PANARY_CONFIG_PATH` auf ein eigenes Datenverzeichnis — nie `data/` des Haupt-Checkouts.
Liegt dort eine `panary.config.json` mit `adminEmail`/`adminPassword`/`locationName`, überspringt der Edge
den Setup-Modus und legt Admin, Tenant und Filiale selbst an.

## Kopplung ohne Handarbeit

**Edge ↔ Cloud** (alles per HTTP, Gemessen am 2026-10-13):

1. Cloud-Login über `POST /account-login` (`{ email, password }`) — **nicht** `/authentication`, das
   antwortet für Tenant-Konten mit 401.
2. `POST /edge-pairing-codes` mit `{ suggestedLocationId }` → Feld `code` (nur in dieser Antwort).
3. Edge-Login über `POST /authentication` (`strategy: 'local'`, `email`).
4. `POST /cloud-connection` mit Header `X-Service-Method: startBootstrap` und
   `{ cloudUrl, pairingCode, edgeName, initialDirection: 'pull-cloud-to-edge', confirmDataLoss: true }`.
   `cloudUrl` muss `localhost` sein (`ensureSecureUrl` lässt sonst nur HTTPS zu).
5. Auf `bootstrapStatus = done` in `cloud-connection` warten.

**POS ↔ Edge:**

1. `POST /device-pairing/request-code` mit Edge-JWT eines Owners/Managers und `{ locationId }`.
2. `POST /device-pairing/redeem` mit `{ code, deviceName, deviceType: 'pos-counter' }`.
3. Die Antwort in der Form von `DeviceConfigService.redeemPairingCode` nach
   `localStorage.panary_device_config` schreiben (`serverUrl`, `deviceId`, `apiKey`, `deviceName`,
   `deviceType`, `tenantId`, `locationId`, `language`, `registeredAt`), Seite neu laden — der POS steht
   gekoppelt am PIN-Bildschirm.

🚫 Nicht das Setup-Formular des POS benutzen: Sein Server-Default (`setup.component.ts`) bleibt
`http://localhost:3030` und koppelt an den eigenen Dev-Edge, nicht an die Sandbox.

## Was am Edge ankommt

Gemessen nach `pull-cloud-to-edge` gegen den Sandbox-Tenant mit Demo-Profil:

- Personal der gekoppelten Filiale mit `posPin`-Hash und `mustChangePosPin = 0` — die Cloud hasht die PIN
  beim Anlegen, der Sync überträgt den Hash. **Ein eigener PIN-Seed am Edge ist nicht nötig.**
- Die Filiale mit `genericUserSettings` (8 h Auto-Logout) und `deviceSecuritySettings`
  (90 Tage Re-Verifikation).
- Katalog (40 Artikel, 12 Warengruppen).
- Login am POS mit Test-PIN führt direkt aufs Dashboard, ohne PIN-Wechsel und ohne Re-Verifikation.

Erst seit panary/panary-cloud#1142: Vorher reiste die Kennzeichnung `__seedTestData` der Seed-Werkzeuge mit,
und der Edge verwarf seine eigene Filiale (`own_location_missing`).

## Nicht abgedeckt

- Alles, was nur in Tauri läuft: mDNS-Hub-Suche, Updater, Bon-Druck über MQTT, TSE.
- Langzeitverhalten (Schlüssel-Rotation, Re-Verifikation nach Tagen) — die großzügigen Einstellungen
  blenden es gerade aus.
- Der POS läuft aus dem Worktree im Browser, nicht als ausgelieferter Build.
