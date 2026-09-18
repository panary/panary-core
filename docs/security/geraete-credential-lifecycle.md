---
type: Architecture
title: Geräte-Credential-Lifecycle — Befristung, Rotation, Kaskade und Nutzungs-Telemetrie
description: Ein Geräte-Schlüssel darf nur mit einer der vier DEVICE_*-Rollen ausgestellt werden, ist 180 Tage gültig und wird im Handshake still rotiert; beim Löschen eines Geräts wird er serverseitig mitwiderrufen, und apikeys.lastUsedAt wird an beiden Auth-Pfaden gedrosselt gestempelt und trägt zusätzlich die Re-Verifikations-Frist.
tags: [devices, apikeys, security]
status: stable
generated: { by: claude-code/opus-5, at: 2026-09-18T11:40:00Z }
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
die das Feld ursprünglich beantwortete, ist „wird dieses Credential überhaupt noch
benutzt" — nicht „ist das Gerät gerade online". Letzteres liefern `devices.lastSeen`
(Connect/Disconnect) und der `device-connections`-Service (Live-Registry) bereits
exakt.

⚠️ **Seit [ADR 0043](../adr/0043-re-verifikation-nach-langer-offline-phase.md) hat das
Feld einen zweiten Leser, und der wertet es als Frist aus.** Es ist damit nicht mehr
nur Telemetrie: `now - lastUsedAt` entscheidet, ob ein Terminal beim nächsten
Handshake eine Bestätigung schuldet. Wer es künftig anders stempelt — häufiger,
seltener, an einer dritten Stelle —, verschiebt damit eine Sicherheitsschwelle.

Der Map-Eintrag wird **vor** dem `await` gesetzt (parallele Handshakes) und bei
einem Fehler zurückgenommen, damit ein Fehlversuch die Drossel nicht 5 Minuten
blockiert.

**`{ force: true }` umgeht die Drossel** — genau ein Aufrufer nutzt das, die
Re-Verifikations-Freigabe. Ohne den erzwungenen Stempel träfe ein Reconnect in den
nächsten fünf Minuten noch auf den alten Wert, und der Bediener stünde wieder vor
dem Bildschirm, den er gerade quittiert hat.

### Resolver-Weiche

`apikeyPatchResolver` lässt `lastUsedAt` nur für interne Aufrufer durch:

```ts
lastUsedAt: async (value, _data, context) => (context.params.provider ? undefined : value)
```

Extern bleibt es gesperrt, damit sich Nutzung weder vortäuschen noch verschleiern
lässt. Bewusst diese Variante statt `service._patch()`: die Regel bleibt im
Resolver sichtbar und testbar.

**Seit der Schlüssel-Rotation ([ADR 0042](../adr/0042-geraete-schluessel-rotation-mit-karenz.md))
gibt es eine zweite Weiche** — und sie ist absichtlich enger als diese hier:
`apikey`, `apikeyPrefix`, `pendingApikey*` und `validUntil` verlangen
`provider === undefined` **und** `params._apikeyRotation === true`. Der Marker
wird ausschließlich in `utils/device-apikey-auth.ts` gesetzt. „Irgendein interner
Aufrufer" wäre für Credential-Material zu weit: `apikey` überschreiben heißt, ein
Gerät auszutauschen.

**Alle übrigen Felder bleiben auch intern gesperrt** — `_id`, `tenantId`,
`locationId`, `name`, `description`, `role`, `deviceId`, `createdBy`, `createdAt`.
Ein Invarianten-Test (`apikeys.schema.spec.ts`) hält beides fest: die Liste der
gesperrten Felder **und** dass der Rotations-Marker sie nicht mitöffnet. Damit
wird keine der beiden Weichen als Präzedenzfall für die nächste gelesen.

**Merkposten:** Der Patch bumpt `updatedAt`. Heute folgenlos, weil `apikeys` in
keiner Sync-Allowlist steht. Käme der Service je in `SyncableMasterDataService`,
erzeugt der Throttle-Takt Sync-Rauschen → dann auf `_patch` umstellen.

## Befristung und Rotation

Seit [ADR 0042](../adr/0042-geraete-schluessel-rotation-mit-karenz.md) ist ein
Geräte-Schlüssel nicht mehr unbefristet: TTL 180 Tage, stille Rotation ab 60 Tagen
Restlaufzeit, Karenz 90 Tage nach Ablauf. `validUntil` weist dabei **nie** ab — es
löst die Rotation aus. Das Sperrmittel bleibt `active: false`.

Beide Auth-Pfade teilen sich dafür `utils/device-apikey-auth.ts`; die
Lebenszyklus-Bewertung selbst ist framework-frei und liegt in
`@panary/apikeys/domain` (`apikey-lifecycle.ts`), damit das Cloud-Pendant
dieselbe Semantik bekommt, ohne den Datensatz zu teilen.

## Re-Verifikation nach langer Offline-Phase

[ADR 0043](../adr/0043-re-verifikation-nach-langer-offline-phase.md) baut auf
`lastUsedAt` einen zweiten, vom Schlüsselablauf **getrennten** Mechanismus: Ein Gerät,
das länger als die Schwelle des Standorts (Default 7 Tage,
`location.settings.deviceSecuritySettings.offlineReverifyDays`) geschwiegen hat, wird
im Handshake nicht abgewiesen, sondern markiert (`requiresReverification` auf der
Socket-Connection). Solange das Merkmal steht, lässt
`hooks/require-device-reverification.hook.ts` nur `find`, `get` und `users.verifyPin`
durch; alles andere endet mit `503` und `data.code = 'DEVICE_REVERIFICATION_REQUIRED'`.

Die beiden Mechanismen dürfen sich nicht gegenseitig zurücksetzen, und sie tun es
nicht: Rotation und Promotion patchen `validUntil`/`pendingApikey*` und fassen
`lastUsedAt` nicht an, und der Handshake bewertet die Pause **vor** dem Stempel.

🚨 **Der Ablehnungscode ist 503 und nicht 403.** `classifyOutboxError`
(`libs/shared/offline-cache/src/lib/outbox.ts`) stuft 400/401/403/422 als `terminal`
ein und verwirft den Outbox-Eintrag — eine offline erfasste Bestellung wäre nicht
verzögert, sondern gelöscht.

Freigegeben wird per PIN über den bestehenden `users.verifyPin`; eine Leitungsrolle
(`DEVICE_REVERIFY_AUTHORIZING_ROLES`) gibt regulär frei, jedes andere gültige Konto als
Notfreigabe mit `AuditSeverity.ALERT`. Begründung beider Entscheidungen im ADR.

## Rollen-Allowlist bei der Ausstellung

Ein API-Schlüssel ist ein **Maschinen**-Credential. Welche Rolle er tragen darf,
entscheidet seit panary/panary-core#334 eine Allowlist an der Ausstellung:
`APIKEY_DEVICE_ROLES` in `libs/domains/apikeys/domain/src/lib/apikey.schema.ts`
— genau `DEVICE_POS`, `DEVICE_KDS`, `DEVICE_TABLET`, `DEVICE_KIOSK`.

Vorher stand im Data-Schema `StringEnum(Object.values(UserSystemRole))`, also
auch `platform:owner`. Der Resolver leitete die Rolle zwar aus `device.type` ab,
aber nur als **Default**:

```ts
role: async (value, data, context) => {
  if (value) return value   // ← ein explizit gesendetes `role` gewann
  …
}
```

Ein Client, der `role` mitschickte, bestimmte sie also selbst. Das war **keine
neue Lücke**, die #329 aufgerissen hätte: `channels.ts` liest die Schlüsselrolle
seit jeher korrekt und setzt sie als `deviceRole` auf die Connection — ein so
angelegter Schlüssel hatte über die Feathers-Services längst weitreichende
Rechte. #329 machte lediglich den Print-Pfad konsistent, der die Rolle bis dahin
gar nicht las und alles auf `DEVICE_POS` deckelte
([Nachtrag dort](edge-authorize-hybrid-rbac.md)). Die Einschränkung wurde in
#329 bewusst **nicht** mitgenommen: Ein Deckel im Print-Pfad hätte den offenen
Weg über die Services verdeckt, statt ihn zu schließen.

Durchgesetzt wird sie vom Validator, nicht vom Resolver — `validateData(apikeyDataValidator)`
im `before.create` von `apps/api-edge/src/services/apikeys/apikeys.ts`. Eine Anlage
mit einer Tenant- oder Plattform-Rolle endet mit `400` und einem AJV-Eintrag auf
`/role`. Ohne `role` bleibt alles wie gehabt: Der Resolver leitet aus `device.type`
ab und fällt sonst auf `DEVICE_POS`.

🚨 **Das Lese-Schema `apikeySchema.role` bleibt bewusst weit.** Die Versuchung,
die Einschränkung „konsequenterweise" auch dort nachzuziehen, ist der eigentliche
Fallstrick: Bestandszeilen mit Tenant- oder Plattform-Rolle würden dann jeden
`find` werfen, der sie berührt — die Schlüssel-Liste wäre für den Mandanten
komplett tot, und ausgerechnet der Schlüssel, den man zurückziehen will, wäre
nicht mehr erreichbar. Der Deckel sitzt an der **Anlage**, nicht am Lesen.
`apikey.schema.spec.ts` hält beide Richtungen fest.

⚠️ **Die Allowlist wirkt nur auf neue Schlüssel.** Ein bereits ausgestellter
Schlüssel behält seine Rolle und bleibt wirksam; der PATCH-Resolver verwirft
`role` ohnehin auf jedem Weg, sie ist also auch nicht korrigierbar. Wer einen
solchen Schlüssel loswerden will, setzt `active: false` und stellt einen neuen
aus. In der lokalen Entwicklungs-DB lag am 2026-09-18 nur `device:pos-client` —
das ist eine Momentaufnahme **einer Entwicklungsmaschine** und keine Aussage über
Kundeninstallationen; die misst man dort, wo sie stehen.

⚠️ **`DEVICE_KIOSK` hat keinen Gegenwert in `DeviceType`** (`pos-counter`/`kds`/
`tablet`/`other`) — Kiosk-Schlüssel entstehen ausschließlich über das
Rollen-Dropdown im Admin, nie über den Resolver-Zweig. Die Rolle bleibt deshalb
in der Allowlist.

**Das Dropdown liest dieselbe Konstante.** `apps/admin-client/.../apikey-form.ts`
baut seine `<option>`-Liste aus `APIKEY_DEVICE_ROLES` statt aus vier festen
Template-Zeilen — sonst könnte die UI eine Rolle anbieten, die die API mit 400
abweist. Die Übersetzungsschlüssel liegen weiter lokal (`ROLE_LABEL_KEYS`), und
`formatRole` fällt für unbekannte Werte auf den Rohwert zurück: Ein
Bestandsschlüssel mit weiter Rolle soll in der Liste **sichtbar** sein, nicht
verschwiegen.

### Gilt in beiden Repos

Das Schema liegt in `@panary/apikeys/domain`, und **panary-cloud zieht es aus der
Registry** statt ein eigenes zu definieren
(`apps/api-cloud/src/services/apikeys/apikeys.schema.ts`). Dort wirkt die
Einschränkung erst nach einem Pin-Bump von `@panary/apikeys` — abgelegt als
panary/panary-cloud#470, zusammen mit dem zweiten, identischen Rollen-Resolver.
Reihenfolge: erst core released, dann dort pinnen.

`apikeys` ist **kein** Sync-Service (die Allowlists entstehen aus
`SyncableMasterDataService`/`SyncableTransactionService` in
`libs/domains/edge-pairing/domain/src/lib/edge-pairing-request.schema.ts`). Es gibt
also keinen Pfad, auf dem eine Bestandszeile mit weiter Rolle neu angelegt und
dabei gegen das Data-Schema validiert würde.

## Beteiligte Dateien

- `apps/api-edge/src/hooks/cascade-device-apikeys.hook.ts`
- `apps/api-edge/src/utils/apikey-last-used.ts`
- `apps/api-edge/src/utils/device-apikey-auth.ts` — gemeinsame Prüfstelle beider Auth-Pfade
- `apps/api-edge/src/utils/device-reverification.ts` — Schwelle, Audit, Freigabe (ADR 0043)
- `apps/api-edge/src/hooks/require-device-reverification.hook.ts` — Durchsetzung
- `libs/domains/devices/domain/src/lib/device-reverification.ts` — Schwellen-Auflösung, framework-frei
- `libs/domains/apikeys/domain/src/lib/apikey-lifecycle.ts` — Schwellen und Bewertung
- `libs/domains/apikeys/domain/src/lib/apikey.schema.ts` — `APIKEY_DEVICE_ROLES`, Data- vs. Lese-Schema
- `apps/api-edge/src/services/apikeys/apikeys.schema.ts` — Patch-Resolver, Rollen-Default aus `device.type`
- `apps/api-edge/src/channels.ts`, `apps/api-edge/src/print-server/auth.middleware.ts`
- `apps/admin-client/src/app/features/apikeys/apikey-form.ts` — Verwaist-Anzeige, Rollen-Dropdown
