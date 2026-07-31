---
type: Architecture
title: Geräte-Credential-Lifecycle — API-Key-Kaskade und Nutzungs-Telemetrie
description: Beim Löschen eines Geräts wird sein API-Schlüssel serverseitig mitwiderrufen, und apikeys.lastUsedAt wird an beiden Auth-Pfaden gedrosselt gestempelt.
tags: [devices, apikeys, security]
status: stable
generated: { by: claude-code/opus-5, at: 2026-07-31T20:20:00Z }
---

# Geräte-Credential-Lifecycle

Ergänzt das [Hybrid-RBAC am Edge](edge-authorize-hybrid-rbac.md) um den
Lebenszyklus der Geräte-Credentials.

## Ausgangslage

Ein Gerät und sein API-Schlüssel entstehen zusammen: der `after.create`-Hook in
`apps/api-edge/src/services/devices/devices.ts` legt beim Anlegen automatisch
einen `apikeys`-Record an und verknüpft ihn über `device.apiKeyId`. Die
Referenz ist bidirektional (`apikeys.deviceId` → `devices.deviceId`).

Zwei Lücken auf der Gegenseite:

1. **`devices.remove` hatte gar keinen Hook.** Jedes gelöschte Gerät hinterließ
   einen verwaisten, weiterhin gültigen Schlüssel. Der WebSocket-Handshake prüft
   nur `apikeyRecord.active` — er merkt nicht, dass die `deviceId` ins Leere zeigt.
2. **`apikeys.lastUsedAt` wurde nirgends geschrieben.** Spalte und Schema-Feld
   existierten, der PATCH-Resolver verwarf den Wert sogar aktiv. Der Admin zeigte
   deshalb bei *jedem* Schlüssel dauerhaft „Nie verwendet" — Revocation-Hygiene
   war damit nicht möglich.

## Kaskade beim Geräte-Delete

Zwei Hooks in `apps/api-edge/src/hooks/cascade-device-apikeys.hook.ts`, weil
`before.remove` nur `context.id` kennt und nach dem Löschen die Zuordnung nicht
mehr auflösbar ist:

- `before.remove: captureDeviceForCascade` — merkt `deviceId` und `apiKeyId` auf
  `params`. Degradiert bei Lookup-Fehlern, statt den `remove` zu blockieren.
- `after.remove: cascadeRemoveDeviceApikeys` — widerruft und löscht.

**Auflösungsrichtung:** primär `apikeys.find({ deviceId })`, `apiKeyId` nur als
Ergänzung. `apiKeyId` setzt ein best-effort-Hook, dessen Fehler nur geloggt wird
(`devices.ts`) — es kann fehlen. Und ein Gerät kann mehr als einen Schlüssel
haben.

**Reihenfolge:** Gerät zuerst, Schlüssel danach. Umgekehrt bliebe bei einem
Fehler ein Gerät ohne Credential zurück — stilles Bricking. Pro Schlüssel erst
`patch({ active: false })`, dann `remove()`: scheitert der `remove`, ist der
Schlüssel wenigstens entwertet.

Keine Transaktion — das etablierte Muster hier ist „best effort + Wide Event"
(`device.cascade_apikeys` / `device.cascade_apikeys_failed`). Ein Rest wird im
Admin als verwaister Schlüssel sichtbar und ist dort löschbar.

`params.user` wird durchgereicht, damit `recordAuditEvent` greift:
`AUDIT_RESOURCE_MAP` kennt `apikeys.remove` als `API_KEY_REVOKE`, der Hook steigt
aber ohne Akteur aus.

### Bekannte Restlücke

`devices.active` wird in **keinem** Auth-Pfad ausgewertet — weder im
WS-Handshake (`channels.ts`) noch in der Print-Server-Middleware. Ein
„Gerät deaktivieren" wäre heute wirkungslos und ist deshalb bewusst **nicht** im
Admin angeboten. Wer es einführt, muss zuerst beide Auth-Pfade härten; das ist
eine Fail-closed-Änderung und sperrt Schlüssel aus, deren `deviceId` auf keinen
Device-Record zeigt.

## Nutzungs-Telemetrie (`lastUsedAt`)

`apps/api-edge/src/utils/apikey-last-used.ts`, aufgerufen an beiden Auth-Punkten
und **nur bei erfolgreicher** Authentifizierung — ein Stempel auf Fehlversuche
wäre ein Schreib-Amplifikator für beliebige Aufrufer.

**Drosselung: ein Write je Schlüssel und 5 Minuten.** SQLite hat genau einen
Writer, und der Print-Server-Pfad authentifiziert pro HTTP-Request. Die Frage,
die das Feld beantwortet, ist „wird dieses Credential überhaupt noch benutzt" —
nicht „ist das Gerät gerade online". Letzteres liefern `devices.lastSeen`
(Connect/Disconnect) und der `device-connections`-Service (Live-Registry) bereits
exakt.

Der Map-Eintrag wird **vor** dem `await` gesetzt (parallele Handshakes) und bei
einem Fehler zurückgenommen, damit ein Fehlversuch die Drossel nicht 5 Minuten
blockiert.

### Resolver-Weiche

`apikeyPatchResolver` lässt `lastUsedAt` nur für interne Aufrufer durch:

```ts
lastUsedAt: async (value, _data, context) => (context.params.provider ? undefined : value)
```

Extern bleibt es gesperrt, damit sich Nutzung weder vortäuschen noch verschleiern
lässt. Bewusst diese Variante statt `service._patch()`: die Regel bleibt im
Resolver sichtbar und testbar. **Alle übrigen Felder bleiben auch intern
gesperrt** — ein Invarianten-Test (`apikeys.schema.spec.ts`) hält das fest, damit
die Weiche nicht als Präzedenzfall für `role`, `deviceId` oder `apikey` gelesen
wird.

**Merkposten:** Der Patch bumpt `updatedAt`. Heute folgenlos, weil `apikeys` in
keiner Sync-Allowlist steht. Käme der Service je in `SyncableMasterDataService`,
erzeugt der Throttle-Takt Sync-Rauschen → dann auf `_patch` umstellen.

## Beteiligte Dateien

- `apps/api-edge/src/hooks/cascade-device-apikeys.hook.ts`
- `apps/api-edge/src/utils/apikey-last-used.ts`
- `apps/api-edge/src/services/apikeys/apikeys.schema.ts` — Patch-Resolver
- `apps/api-edge/src/channels.ts`, `apps/api-edge/src/print-server/auth.middleware.ts`
- `apps/admin-client/src/app/features/apikeys/apikey-form.ts` — Verwaist-Anzeige
