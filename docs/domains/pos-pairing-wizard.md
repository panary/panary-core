---
type: Domain Concept
title: POS-Pairing-Wizard — Cloud-Default + lokaler Hub (mDNS/QR/manuell)
description: Geführte POS-Inbetriebnahme mit Panary-Cloud-Default und lokaler Hub-Erkennung via mDNS, QR oder manueller IP samt single-use Pairing-Code-Flow.
tags: [system, devices, data-access-config, pos, pairing]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-02T00:00:00Z }
---

# POS-Pairing-Wizard

## Problem

Der POS-Client (`apps/pos-client`, Tauri-2-Desktop) verlangte im Setup eine **manuell
getippte Server-URL + Admin-E-Mail + Passwort**. Für Gastronomen ohne IT-Kenntnisse ist
„die IP-Adresse des Edge-Servers eintippen" eine massive Hürde.

**Ziel:** extrem einfache Inbetriebnahme. Der Wizard bietet die Panary Cloud als Default an
und für den lokalen Betrieb eine geführte Hub-Erkennung (mDNS / QR / manuell) mit
Kurz-Code-Pairing.

## Flow

```
welcome ──► [Cloud]  ───────────────────────────────────────► server-login
   │          (feste URL https://api.panary.cloud)                  │
   └──► [Lokaler Hub]                                               │
          ▼                                                         │
       hub-prep (Hinweis + flache SVG-Animation)                    │
          ▼ (bestätigt)                                             │
       hub-discover (mDNS-Liste · QR-Scan · manuelle IP)            │
          ▼ (/health-Probe)                                         │
        ├─ setupComplete=false ─► hub-setup-hint (erneut prüfen)    │
        └─ setupComplete=true                                       │
          ▼                                                         │
       hub-auth ── Pairing-Code (bevorzugt) ──► redeem ──► success  │
          └──────── Admin-Login (Fallback) ──────────────────► server-login
                                                                    ▼
                                            select-org ► device-info ► registering ► success ► App-Neustart ► /login
```

Der nachgelagerte Teil (`select-org` → `device-info` → `registerDevice`) bleibt
gegenüber dem alten Setup unverändert und wird wiederverwendet.

Der Abschluss ist bewusst **kein** SPA-Routenwechsel, sondern ein Neustart der App —
siehe [Invariante](#invariante-deviceconfig-wechsel-erfordert-einen-app-neustart).

## Edge (`apps/api-edge`)

### mDNS-Advertising — `src/mdns-advertiser.ts`
- Wirbt den Hub als **`_panary._tcp`** via `bonjour-service`.
- Aufruf nach `app.listen` in `main.ts` (Produktion) **und** in `setup-app.ts` (Setup-Modus).
- **TXT-Records:** `version`, `organizationName`, `setupComplete`, `systemMode`, `locationId`, `hostname`.
- Best-effort: Fehlschlag (blockiertes Multicast, Firewall UDP 5353) blockiert den Edge nicht —
  QR/manuell bleiben nutzbar. Sauberes `unpublish`/`destroy` bei SIGINT/SIGTERM/exit.

#### Betriebsvoraussetzung: Host-Networking im Docker-Betrieb

mDNS ist Multicast auf `224.0.0.251:5353` mit **TTL 1**. Läuft der Edge in einem
Docker-Bridge-Netz, ist Auto-Discovery **prinzipbedingt tot** — und zwar lautlos, weil das
Advertising im Container selbst fehlerfrei startet:

1. Multicast aus dem Bridge-Netz erreicht das physische LAN nicht; ein `ports:`-Mapping
   ändert daran nichts (Port-Forwarding leitet kein Multicast weiter).
2. Der annoncierte A-Record trägt die Container-IP (`172.x`), nicht die LAN-IP des Hosts.
   Selbst ein durchgereichtes Paket ergäbe im Wizard eine unerreichbare URL.
3. Dasselbe trifft den QR-Fallback: dessen Payload nutzt `localIp` aus `/health`, und
   `getLocalIpAddress()` (`src/status-page.ts`) liefert im Container ebenfalls `172.x`.

Deshalb setzt **jeder** Deployment-Pfad `network_mode: host` und verzichtet auf `ports:`:
`tools/docker/docker-compose.edge.yml` (Prod-Test), `…edge.dev.yml` (Dev) und die vom
Installer `tools/hosting/get.panary.cloud/install.sh` generierte `docker-compose.yml` — der
Pfad, unter dem Kunden-Edges tatsächlich laufen. Host-Networking kann Ports nicht umbiegen,
deshalb lauscht der Prozess selbst auf dem Zielport (`PORT`-ENV, gemappt in
`config/custom-environment-variables.json`): Installer `PORT=${PANARY_PORT:-3030}`,
Dev-Compose `PORT=3031` statt `3031:3030`. Watchtower bleibt im `panary-internal`-Netz —
es steuert den Container über den Docker-Socket, nicht über das Netzwerk.

Ist auf dem Host eine Firewall aktiv (ufw), muss **UDP 5353** eingehend offen sein; der
Installer fasst die Firewall nicht an. Ein bereits laufender `avahi-daemon` ist kein
Hindernis — `bonjour-service` bindet mit `SO_REUSEADDR` und koexistiert.

> Nur unter Linux wirksam. Auf Docker Desktop (macOS/Windows) leitet host-networking kein
> Multicast — dort bleiben QR und manuelle IP der Weg. `app.listen(port)` bindet ohne Host,
> die `HOSTNAME`-ENV beeinflusst nur Log-Ausgaben.

**Diagnose bei „Hub wird nicht gefunden":** `docker logs <container> | grep -i mdns` zeigt,
ob der Advertiser lief; `avahi-browse -rt _panary._tcp` **auf dem Host** (nicht im Container)
zeigt, ob die Announcements im LAN ankommen. Beides zusammen trennt Netz-Problem von
Code-Problem. Edge und POS müssen im selben Layer-2-Segment liegen — über Subnetz-,
VLAN- oder WLAN-Isolationsgrenzen hinweg ist mDNS nicht routbar.

### Health-Endpoint — `src/app.ts` (`GET /health`, RBAC-frei)
Zusätzlich zu den bestehenden Feldern: **`organizationName`** + **`setupComplete`**
(aus erster `locations`-Zeile). Der Client probt damit jeden gefundenen/manuell
eingegebenen Hub und zeigt Betriebsname + Setup-Status an.

### Pairing-Code — `src/device-pairing.ts` (zwei Koa-Routen)
| Route | Auth | Zweck |
|---|---|---|
| `POST /device-pairing/request-code` | JWT (TENANT_OWNER/MANAGER) | Erzeugt 6-stelligen Code, gebunden an Tenant+Standort |
| `POST /device-pairing/redeem` | **öffentlich**, rate-limited | Verifiziert Code → legt Gerät intern an → liefert `deviceId`+`apiKey` |

**Sicherheit:** Code single-use + TTL (10 min) + In-Memory-Store; Brute-Force-Schutz
(max. 10 Fehlversuche/IP/Minute); `tenantId`/`locationId` werden **ausschließlich aus dem
Code-Record** gestempelt (nie aus dem Request-Body — `multiTenancy` stempelt bei
`provider:undefined` nicht); Code wird nie geloggt.

> **Bewusste Abweichung vom Feathers-Service-Muster:** `secureByDefault` ist pro-Service
> granular. Ein öffentlicher `redeem` neben geschütztem `request-code` ließe sich nur über
> `publicServices` (zu grob) oder client-seitige Custom-Method-Registrierung lösen.
> Plain-Koa-Routen (wie `/health` und der Setup-Modus) sind hier einfacher und risikoärmer.

## Tauri / Rust (`apps/pos-client/src-tauri`)

- **`discover_panary_hubs`** (in `src/lib.rs`): browst `_panary._tcp.local.` via `mdns-sd`
  (~2,5 s, off-thread via `spawn_blocking`), liefert `[{ name, host, port, addresses, txt }]`.
- **`withGlobalTauri: true`** in `tauri.conf.json` → Frontend ruft den Command über
  `window.__TAURI__.core.invoke` (kein `@tauri-apps/api`-Paket nötig).
- **Linux-Bundle-Targets** ergänzt: `deb` + `appimage` (zusätzlich zu Windows `nsis`).
  `mdns-sd` ist pure-Rust → läuft auf Windows + Ubuntu **ohne Avahi**.

## POS-Client (`libs/shared/data-access-config`, `libs/domains/system/feature-pos-setup`)

- **`HubDiscoveryService`**: `discoverHubs()` (Tauri-`invoke` mit Feature-Detection →
  leere Liste im Browser-Dev) + `probeHub(url, timeoutMs?)` (`/health` →
  `organizationName`/`setupComplete`).
- **Adresswahl bei multi-homed Hubs:** Ein Hub annonciert alle Interface-Adressen (LAN,
  Docker-Bridge, VPN). Blind die erste zu nehmen führt zu einem Eintrag in der Liste, der
  beim Pairing scheitert. Stattdessen: IPv4 zuerst, darin vorsortiert nach `addressRank`
  (link-local → CGNAT `100.64/10` → Docker-Range `172.16/12` → Rest), dann `/health`-Probe
  aller Kandidaten parallel (1,5 s) — die erste erreichbare Adresse in Rangfolge gewinnt.
  Ist keine erreichbar, bleibt die vorsortierte URL stehen, damit der Hub sichtbar bleibt
  statt stumm zu verschwinden. Die Liste erscheint sofort und wird nach dem Probe ersetzt.

> **Warum clientseitig?** `bonjour-service` erzeugt die A-Records in `Service.records()`
> hart über `os.networkInterfaces()` — jede nicht-interne Adresse wird annonciert, ohne
> Filtermöglichkeit. Die `interface`-Option des Konstruktors steuert nur den Multicast-
> Socket, nicht den Record-Inhalt. Der Edge kann also nicht ansagen, unter welcher seiner
> Adressen er gemeint ist; die Auswahl gehört zwangsläufig auf die Client-Seite.
>
> Real beobachtet (2026-07-27, Edge `26.7.28` auf host-networking): annonciert wurden
> `172.18.0.1` (Bridge des `panary-internal`-Netzes, das Watchtower weiter nutzt) **und**
> `10.10.100.77`. Ein Client ohne Rangfolge landete auf `172.18.0.1` → „Hub nicht
> erreichbar" trotz erfolgreicher Discovery. Die Bridge lässt sich nicht wegkonfigurieren:
> ohne `panary-internal` bliebe `docker0` mit `172.17.0.1`.
- **`DeviceConfigService.redeemPairingCode(serverUrl, code, device)`**: ruft
  `POST /device-pairing/redeem`, speichert `DeviceConfig` (gleiche Shape wie `registerDevice`).
- **`APP_CONFIG.cloudUrl`** (`https://api.panary.cloud`): Default-Ziel des Cloud-Pfads.
- **`SetupComponent`**: verzweigter `SetupStep`-Flow, Signals + OnPush, i18n (de/en/tr),
  flache CSS-/SVG-Animationen. QR-Scan dependency-frei via `BarcodeDetector`
  (degradiert auf WebKitGTK → manuelle Eingabe).

## Invariante: DeviceConfig-Wechsel erfordert einen App-Neustart

> Jeder Pfad, der `panary_device_config` schreibt oder löscht, **muss** mit einem
> Neustart der App enden — nicht mit `router.navigate()`.

**Ursache.** `ConnectionService`
(`libs/shared/data-access/src/lib/services/connection.service.ts`) baut den
socket.io-Socket genau einmal im Konstruktor, und der läuft im
`provideAppInitializer` (`apps/pos-client/src/app/offline-cache.provider.ts`) — also
**vor jeder Route**. URL und `auth`-Payload sind in den socket.io-Optionen danach
unveränderlich; `connect()` reaktiviert nur dieselbe eingefrorene Konfiguration.

Beim Erst-Setup existiert zum Bootstrap-Zeitpunkt noch keine DeviceConfig. Der Socket
entsteht deshalb im Admin-/User-Zweig: Default-URL, **ohne** `auth: { apiKey, deviceId }`.
Das Gerät bekommt nie ein `device:authenticated`, der Login-Screen läuft in seinen
Timeout — und ein Retry auf demselben Socket scheitert zwangsläufig erneut.

**Betroffene Pfade — alle enden mit einem Neustart:**

| Pfad | Ort |
|---|---|
| Pairing-Abschluss | `SetupComponent.rebootIntoApp()` (Ziel `/`, wie jeder Kaltstart) |
| Gerät entkoppeln | `unpair-device-dialog.component.ts` |
| Gerät zurücksetzen | `LoginComponent.resetDevice()` |
| „Neu einrichten" nach Verbindungsfehler | `LoginComponent.goToSetup()` |

**Warum kein Socket-Hot-Swap.** `BaseService` friert die Feathers-Service-Referenz im
Konstruktor ein und registriert dort die Realtime-Listener (`created`/`updated`/
`patched`/`removed`); über ein Dutzend `providedIn: 'root'`-Subklassen holen sie genau
einmal. Ein Austausch des Sockets ließe Reads **und** die komplette Realtime-Ebene still
verstummen — ohne Fehler, ohne Log.

**Was der Neustart mitzieht.** Zwei weitere Konsumenten lesen die Config ebenfalls nur
einmal beim Bootstrap: der Offline-Cache (`initPosOfflineCache` kehrt ohne `tenantId`/
`serverUrl` früh zurück und wird nie nachgeholt) und die Health-Poll-URL
(`#lastHealthUrl`, speist `systemMode` und den Cloud-Status-Banner). Ohne Neustart bleiben
beide bis zum nächsten App-Start falsch.

**Erkennung.** `ConnectionService.isConfiguredFor(config)` vergleicht die eingefrorene
Socket-Identität (`deviceId` + Protokoll/Host) mit der aktuell gespeicherten Config. Der
Retry-Button im POS-Login nutzt das: bei Abweichung startet er die App neu, statt
aussichtslos weiter zu verbinden. Reine Funktion `matchesSocketIdentity()` in
`socket-identity.ts`, unit-getestet.

## Admin-Client (`apps/admin-client`)

In der Geräte-Liste (`features/devices/device-list.ts`): Button **„Gerät koppeln"** →
`device-pairing.request-code` → zeigt den Code groß + **QR** (`angularx-qrcode`,
Payload `{ url, code }` mit `localIp:port` aus `/health`). Der POS scannt den QR oder
tippt den Code.

## ADR — mDNS-Browsing nativ in Rust

**Problem:** mDNS/Bonjour benötigt UDP-Multicast (224.0.0.251:5353). Aus dem WebView (JS)
gibt es keinen Zugriff auf rohe UDP-Sockets — Auto-Discovery ist im Browser-Kontext
unmöglich.

**Entscheidung:** Browsing läuft im **Tauri-Rust-Layer** (`mdns-sd`, pure-Rust) als
Command `discover_panary_hubs`, angesprochen über `withGlobalTauri`. Edge-seitig wirbt
`bonjour-service` (Node).

**Konsequenzen:** Auto-Discovery nur im Tauri-Build (Browser-Dev → leere Liste, daher QR +
manuelle IP als Pflicht-Fallbacks). Kein zusätzliches npm-Paket (`@tauri-apps/api`)
notwendig. `mdns-sd` ist plattformübergreifend (Windows/Linux/macOS) ohne Avahi.
Praxis-Risiken (Gäste-WLAN-Isolation, VLANs, Firewall UDP 5353) werden durch QR + manuelle
Eingabe abgefedert.

## Neue Abhängigkeiten

- **Rust:** `mdns-sd` (`Cargo.toml`).
- **Edge:** `bonjour-service` (von transitiv → direkte Dependency in `package.json`).
- **POS-/Admin-Client:** QR via nativem `BarcodeDetector` (Scan) bzw. `angularx-qrcode`
  (Anzeige, bereits vorhanden) — keine neue Scanner-Lib.

## Verifikation

1. `nx serve api-edge`; `curl localhost:3030/health` → `organizationName` + `setupComplete`.
2. `POST /device-pairing/redeem` mit ungültigem Code → `400`; ohne Auth bei `request-code` → `401`.
3. POS-Wizard (Browser-Preview): welcome → hub → manuelle IP → `/health`-Probe → hub-auth
   („Verbunden mit: <Betrieb>"); Sprachwechsel de/en/tr.
4. `discover_panary_hubs` im Tauri-Build (Windows + Ubuntu); Linux-Bundle (`deb`/`appimage`)
   baut durch — offen: erfordert `cargo`/Tauri-Toolchain-Run.
