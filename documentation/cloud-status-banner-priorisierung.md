---
title: Cloud-Status-Banner — priorisiertes Einzel-Banner-System (POS + Admin)
date: 2026-05-27
category: Architektur
domains: [cloud-connection, shared/data-access, shared/ui]
status: implemented
---

# Cloud-Status-Banner — priorisiertes Einzel-Banner-System

## Problem

POS- und Admin-Client zeigten mehrere Cloud-Status-Hinweise **gleichzeitig und
unkoordiniert** oben am Bildschirm:

- vollbreiter Outage-Banner „Cloud-Verbindung nicht erreichbar" + „Offline-Modus
  aktivieren" (nur Admin, eigene Komponente, eigenes Polling auf `cloud-connection`),
- schwebende Pillen „Letzter Cloud-Sync vor X min" und „Token abgelaufen — neu pairen"
  (`<lib-cloud-status-badges>`, POS + Admin),
- im POS zusätzlich hardcodierte „Offline"- und „neu pairen"-Pillen.

Das war optisch unaufgeräumt und sachlich redundant: mehrere Meldungen beschrieben
dieselbe Wurzelursache (ein abgelaufener Token erzeugt zugleich „nicht erreichbar"
und „Sync veraltet"). Jeder Konsument rannte seine eigene Logik — keine zentrale
Priorisierung.

## Entscheidung

**Es ist immer nur EIN Banner sichtbar** — der mit der höchsten Gewichtung. Alle
möglichen Zustände liegen in einer zentralen, gewichteten Regel-Liste; eine pure
Funktion wählt den höchstpriorisierten aktiven Zustand. Die Leiter bildet die
**Kausalität** ab: eine Wurzelursache unterdrückt nachgelagerte Symptome.

### Prioritätsleiter (höchstes Gewicht zuerst)

| # | id | Bedingung | Gewicht | level | Action |
|---|----|-----------|---------|-------|--------|
| 1 | `client-offline` | WS `disconnected`/`error` **und nicht** `userSessionExpired` | 100 | crit | `reload` |
| 2 | `re-pairing-required` | `cloudNeedsRePairing` (Tier 3 + `cloudPairingStatus==='disconnected'`) | 90 | crit | – |
| 3 | `offline-mode-active` | Override aktiv (`offlineOverrideActiveUntil` in Zukunft) | 80 | warn | – (Restminuten) |
| 4 | `token-expired` | `tokenExpiry.level==='crit'` & `remainingSec<=0` | 70 | crit | – |
| 5 | `cloud-unreachable` | Tier 3 + pairing connected + `lastCloudContactAt` > 90s + Override inaktiv | 60 | crit | `activate-offline-mode` |
| 6 | `token-expiring-soon` | `tokenExpiry.level==='warn'` | 40 | warn | – |
| 7/8 | `sync-stale` | `syncStaleness.level==='crit'`/`'warn'` | 30/20 | warn/info | – |

Einträge 2–8 nur in **Tier 3** (`showsCloudSyncStatus` / `systemMode==='connected'`).
Kein Eintrag aktiv → kein Banner.

**Begründungen:**

- `client-offline` (w100) unterdrückt alle Cloud-Banner: ist der Edge nicht
  erreichbar, ist der `/health`-State veraltet → alle Cloud-Aussagen unzuverlässig;
  einzige sinnvolle Aktion ist Reload. Unterdrückt bei `userSessionExpired()`, weil
  dann der Auth-Flow (Logout + Login-Redirect) übernimmt.
- `offline-mode-active` (w80) **über** token-expired/cloud-unreachable: der Operator
  hat den Offline-Modus bewusst aktiviert; sein Countdown darf nicht vom Symptom
  verdeckt werden, das er bereits akzeptiert hat. `re-pairing-required` (w90) bleibt
  darüber — neues, hartes, aktionspflichtiges Versagen.
- Referenz-Szenario (Praxis): pairing connected, Token abgelaufen, Sync 12 min,
  `lastCloudContactAt` stale → Sieger **`token-expired`** → nur „Token abgelaufen —
  neu pairen". (Der abgelaufene Token ist die Wurzel; „nicht erreichbar" + „Sync
  veraltet" sind Folgen.)
- **Stale-Schwelle 90s** (nicht 60s): Heartbeat 30s + `/health`-Poll 60s + Puffer,
  sonst flackert der Banner bei ~61s.

## Architektur

```
/health (RBAC-frei)
  └─ lastSyncAt, edgeTokenExpiresAt, cloudPairingStatus, cloudTokenErrorReason,
     systemMode, lastCloudContactAt*, offlineOverrideActiveUntil*      (* neu)
        │  60s-Poll
        ▼
ConnectionService (libs/shared/data-access)
  └─ Signals + Computeds: connectionState, syncStaleness, tokenExpiry,
     cloudNeedsRePairing, showsCloudSyncStatus, userSessionExpired,
     offlineModeActive, offlineModeRemainingMin, cloudUnreachable*,
     lastCloudContactAgeMin*                                            (* neu)
        │
        ▼
selectActiveBanner(state)  ── pure, gewichtete Leiter → CloudBanner | null
        │  (CloudStatusBannerService.activeBanner = computed)
        ▼
<lib-cloud-status-banner>  ── EINE zentrierte adaptive Karte, Action-Output
        │
   ┌────┴────┐
  POS        Admin (enableOfflineModeAction=true → OfflineOverrideService.activate())
```

**Pure Selektor-Funktion** (`cloud-status-banner.selector.ts`): kein DI, keine
Signals → ohne TestBed unit-testbar (11 Specs, u.a. der Referenz-Fall). Der
`CloudStatusBannerService` wrappt sie in ein `computed()` aus den
ConnectionService-Signals.

**UI** (`<lib-cloud-status-banner>`): zentrierte, abgerundete Karte oben
(positioniert sich selbst). Inhalt adaptiv — Info kompakt (Icon + Text), kritisch
mit Subline + Action-Button; Farbe nach `level`. Die `activate-offline-mode`-Aktion
ist per `enableOfflineModeAction`-Input gegated (Admin `true`; POS `false`, weil das
Device kein RBAC-Write auf `cloud-connection` hat). Die `reload`-Aktion ist überall
verfügbar.

**Offline-Modus-Aktion**: im Admin-Host (`OfflineOverrideService`) über den
HTTP-`ApiService` (RBAC `CLOUD_CONNECTION: MANAGE` → TENANT_OWNER/TENANT_TECHNICIAN);
setzt `offlineOverrideActiveUntil = now + 2h`. Auto-Reset auf `null` weiterhin beim
nächsten erfolgreichen Cloud-Pull (`cloud-pull-business-days.worker.ts`).

## Sekundär-Fix: Token-Fehler beim Re-Pairing zurücksetzen

`tokenErrorReason` + `lastTokenErrorAt` im Hauptschema von `cloud-connection`
nullable gemacht (Patch-Schema erbt via `Type.Pick`) und in `startBootstrap`
`upsertData` auf `null` gesetzt. Sonst meldete `/health` nach erfolgreichem
Re-Pairing weiter einen veralteten `tokenErrorReason` (z.B. `'token-expired'`).
Risikofrei: `cloud-connection` wird **nicht** zur Cloud gesynct, `null` ist das
etablierte Clear-Pattern, keine DB-Migration nötig (SQLite-Spalten bereits nullable).

## Konsequenzen

- Die Outage-Banner-Komponente (`offline-override-banner.ts`) und die Sync/Token-
  Badges (`<lib-cloud-status-badges>` + `cloud-status.types.ts`) wurden **entfernt** —
  ihre Funktion ist nun je ein Eintrag der Prioritätsleiter.
- Schwellwerte bleiben zentral statisch im `ConnectionService`
  (`SYNC_WARN_SEC`/`SYNC_CRIT_SEC`/`TOKEN_WARN_SEC`/`TOKEN_CRIT_SEC`/
  `CLOUD_CONTACT_STALE_SEC`) — später per Tenant-Settings überschreibbar.
- Der **Setup-Client** bleibt bewusst unverändert (eigener Landing-Kontext,
  einmaliger `/health`-Check, eigener Re-Pairing-Hinweis).

## Dateien

**Backend (Edge):**
- `apps/api-edge/src/app.ts` — `/health` um `lastCloudContactAt` + `offlineOverrideActiveUntil`
- `libs/domains/cloud-connection/domain/src/lib/cloud-connection.schema.ts` — `tokenErrorReason`/`lastTokenErrorAt` nullable
- `apps/api-edge/src/services/cloud-connection/cloud-connection.ts` — `startBootstrap`: Token-Fehler-Reset

**Shared:**
- `libs/shared/data-access/src/lib/services/connection.service.ts` — neue Signals/Computeds
- `libs/shared/data-access/src/lib/services/cloud-status-banner.selector.ts` (+ `.spec.ts`) — pure Prioritätsleiter
- `libs/shared/data-access/src/lib/services/cloud-status-banner.service.ts` — `activeBanner` computed
- `libs/shared/ui-cloud-status/src/lib/cloud-status-banner/cloud-status-banner.component.ts` — `<lib-cloud-status-banner>`

**Apps:**
- `apps/admin-client/src/app/app.ts` + `core/offline-override.service.ts`; Entfernung in `layout/admin-layout.ts`
- `apps/pos-client/src/app/app.ts`
- `apps/{admin-client,pos-client}/src/assets/i18n/{de,en,tr}.json` — `CLOUD_STATUS`-Keys

## Verifikation

- Unit: `nx test data-access` — 11 Selektor-Specs (alles-ok→null, Referenz-Fall→token-expired,
  re-pairing>token, client-offline schlägt alles, userSessionExpired unterdrückt client-offline,
  offline-mode>token, cloud-unreachable+Action, token-expiring Stunden-Key, sync-stale info-Level,
  nicht-Tier-3→null, client-offline auch außerhalb Tier 3).
- Build/Lint: `nx run-many -t lint,test,build -p data-access shared-ui-cloud-status
  cloud-connection-domain api-edge admin-client pos-client` — grün.
- Manuell (offen, vom Operator durchzuspielen): WS trennen → „Offline"+Reload; Token ablaufen →
  „Token abgelaufen"; Cloud kurz weg → „nicht erreichbar"+Subline+Button (nur Admin) → „Offline-Modus
  aktiv noch X min"; Re-Pairing → Token-Banner verschwindet sofort, `tokenErrorReason` im `/health` `null`;
  nie mehr als ein Banner gleichzeitig.
