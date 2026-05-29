---
title: POS-Pairing-Wizard — Cloud-Default + lokaler Hub (mDNS/QR/manuell)
date: 2026-05-30
category: Architektur
domains: [system, devices, shared/data-access-config]
status: active
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
   │          (feste URL https://cloud.panary.io)                   │
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
                                            select-org ► device-info ► registering ► success ► /login
```

Der nachgelagerte Teil (`select-org` → `device-info` → `registerDevice`) bleibt
gegenüber dem alten Setup unverändert und wird wiederverwendet.

## Edge (`apps/api-edge`)

### mDNS-Advertising — `src/mdns-advertiser.ts`
- Wirbt den Hub als **`_panary._tcp`** via `bonjour-service`.
- Aufruf nach `app.listen` in `main.ts` (Produktion) **und** in `setup-app.ts` (Setup-Modus).
- **TXT-Records:** `version`, `organizationName`, `setupComplete`, `systemMode`, `locationId`, `hostname`.
- Best-effort: Fehlschlag (blockiertes Multicast, Firewall UDP 5353) blockiert den Edge nicht —
  QR/manuell bleiben nutzbar. Sauberes `unpublish`/`destroy` bei SIGINT/SIGTERM/exit.

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
  leere Liste im Browser-Dev) + `probeHub(url)` (`/health` → `organizationName`/`setupComplete`).
- **`DeviceConfigService.redeemPairingCode(serverUrl, code, device)`**: ruft
  `POST /device-pairing/redeem`, speichert `DeviceConfig` (gleiche Shape wie `registerDevice`).
- **`APP_CONFIG.cloudUrl`** (`https://cloud.panary.io`): Default-Ziel des Cloud-Pfads.
- **`SetupComponent`**: verzweigter `SetupStep`-Flow, Signals + OnPush, i18n (de/en/tr),
  flache CSS-/SVG-Animationen. QR-Scan dependency-frei via `BarcodeDetector`
  (degradiert auf WebKitGTK → manuelle Eingabe).

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
