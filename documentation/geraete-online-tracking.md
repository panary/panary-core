---
title: Geräte-Online-Tracking (Edge) — Echtzeit-Verbindungszählung + Admin-Panel
date: 2026-05-22
category: Architektur
domains: [devices]
status: implementiert
---

# Geräte-Online-Tracking (Edge) — Echtzeit-Verbindungszählung + Admin-Panel

Spiegelt das Cloud-Feature (`panary-cloud/documentation/geraete-online-tracking.md`)
auf den Edge-Server. Das Edge-Admin-Panel (`apps/admin-client`) zeigt jetzt, **wie
viele Geräte registriert** und **wie viele gerade mit dem Edge verbunden** sind.

## Problem

Geräte (POS/KDS/Tablet) verbinden sich per Socket-Handshake (`apiKey`+`deviceId`,
`apps/api-edge/src/channels.ts`), aber es gab keine Sicht auf die aktive Verbindung.
`lastSeen` (im geteilten `@panary/devices/domain`-Schema) wurde nie geschrieben.

## Lösung

Konzept-Trennung: `active` = Admin-Flag (registriert/freigeschaltet); „verbunden" =
Live-Socket-Zustand. Quelle ist die Feathers-Channel-Registry des Edge.

### Backend (`apps/api-edge`)

- **`device-connections`-Service**
  ([`services/device-connections/device-connections.ts`](../apps/api-edge/src/services/device-connections/device-connections.ts)):
  read-only `find` → `{ online, total, connectedDeviceIds }` für `params.user.tenantId`.
  - **online/connectedDeviceIds:** `app.channel('authenticated').connections` filtern auf
    `conn.tenantId === tenantId && conn.deviceId` (Device-Connections joinen diesen Channel
    nach erfolgreicher API-Key-Auth), eindeutige `deviceId`s. Disconnect entfernt die
    Connection automatisch → Zähler stimmt ohne weiteres Zutun.
  - **total:** interner `app.service('devices').find({ tenantId, active: true, $limit: 0 })`.
  - Hooks `around.all: [authenticate('jwt'), authorize()]`. Registrierung in
    [`services/index.ts`](../apps/api-edge/src/services/index.ts) nach `devices`.
  - RBAC: `DEVICE_CONNECTIONS` (OWNER+TECHNICIAN) liegt im geteilten `@panary/users/domain`.
- **`lastSeen`-Stamps** ([`channels.ts`](../apps/api-edge/src/channels.ts)): Helper
  `stampDeviceLastSeen` bei Device-Auth-Erfolg + `app.on('disconnect')`.
  ⚠️ Der Edge-`devices`-Service hat `multi: []` → kein `patch(null, …)`; daher per
  `find({ deviceId })` → `patch(_id, …)` (interner Call). `devices` ist nicht in der
  Sync-Allowlist → kein Outbox-/Cloud-Push.

### Frontend (`apps/admin-client`, REST + JWT-Interceptor, OnPush/Signals)

- **`DeviceStatusService`** ([`core/device-status.service.ts`](../apps/admin-client/src/app/core/device-status.service.ts)):
  Polling-Singleton (Signals `online`/`total`/`connectedDeviceIds`), liest via neuem
  `ApiService.getResource` (Plain-GET, kein `Paginated`). `null` = unbekannt (z.B. 403).
- **Dashboard-KPI** ([`features/dashboard/dashboard.ts`](../apps/admin-client/src/app/features/dashboard/dashboard.ts)):
  7. Karte „Geräte" `X / Y`, Farbe grün ≥1 / amber 0 / neutral bei `null`. In ngOnInit +
  30s-Poll aktualisiert.
- **Sidebar-Menüpunkt + Live-Badge** ([`layout/admin-layout.ts`](../apps/admin-client/src/app/layout/admin-layout.ts)):
  NavItem `/devices` mit `connectionBadge` — Pill (verbundene Anzahl) grün ≥1 / amber 0,
  eingeklappt farbiger Dot. Refresh in 60s-Poll.
- **Geräte-Liste** ([`features/devices/device-list.ts`](../apps/admin-client/src/app/features/devices/device-list.ts)):
  read-only Tabelle (Name, Typ, Geräte-ID, Letzte Aktivität, Verbindung Verbunden/Getrennt,
  Status). Route in [`app.routes.ts`](../apps/admin-client/src/app/app.routes.ts).
- **i18n:** `NAV.DEVICES`, `DASHBOARD.KPI_DEVICES`, `DEVICES.*` in `assets/i18n/{de,en,tr}.json`.

## Sichtbarkeit / RBAC
Nur TENANT_OWNER + TENANT_TECHNICIAN (spiegelt `devices`-Leserechte; geteilte Matrix,
keine Änderung). Andere Rollen: KPI „–", kein Badge, Liste leer (403 → graceful).

## Einschränkung
Live-Zählung pro Edge-Prozess (am Edge der Normalfall — Single-Instance). `lastSeen`
liefert zusätzlich „letzte Aktivität" als DB-Record.

## Verwandt
- Cloud-Pendant: `panary-cloud/documentation/geraete-online-tracking.md`
- [Cloud-Status-Badge](cloud-status-badge.md)
