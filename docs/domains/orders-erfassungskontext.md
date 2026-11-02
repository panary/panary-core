---
type: Domain Concept
title: 'Erfassungskontext der Bestellung — Bediener, Gerät und Gerätename'
description: 'Was creationContext.createdBy, createdVia und createdViaName bedeuten, warum Gerät und Gerätename ausschließlich aus der Geräte-Session kommen und als Snapshot nie nachgetragen werden, wie Split, Vorbestellung und Pull-Apply sie behandeln und was eine Cloud ohne Pin-Bump damit tut.'
tags: [orders, devices, edge, sync]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-03T00:00:00Z }
sources:
  - { id: issue-1303, resource: 'https://github.com/panary/panary-core/issues/1303', title: 'panary/panary-core#1303' }
  - { id: cloud-1072, resource: 'https://github.com/panary/panary-cloud/issues/1072', title: 'panary/panary-cloud#1072' }
---

# Erfassungskontext der Bestellung

Jede Bestellung trägt in `creationContext` (`@panary/orders/domain`, `creationContextSchema`), **wer**
sie aufgenommen hat und **an welcher Kasse**. Die Cloud nutzt das für Personalumsatz und
Kassierer-Auswertung (`createdBy`) und für die Bon-Karte im Tagesrad, die „· Kasse X“ nennt
(`createdViaName`, panary/panary-cloud#1072).

| Feld             | Bedeutung                                       | Quelle am Edge                                                             |
| ---------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `createdBy`      | Bediener (Mensch), der die Bestellung aufnimmt  | Bediener-Token einer Geräte-Session (ADR 0053), sonst JWT-User, sonst Body |
| `createdVia`     | Geräte-ID (`device.deviceId`, nicht `_id`)      | Geräte-Session; nur ohne Geräte-Session der Body-Wert                      |
| `createdViaName` | Name des Geräts **zum Buchungszeitpunkt**       | ausschließlich Lookup aus der Geräte-Session                               |

## Warum ein Snapshot und kein Geräte-Sync

Edge-Geräte erreichen die Cloud-Collection `devices` nicht: Die Edge legt beim Pairing nur einen
eigenen Datensatz an, und `devices` steht weder in `SyncableMasterDataService` noch in
`BOOTSTRAP_INGEST_ALLOWLIST`. Eine Geräte-ID allein könnte die Cloud also nicht in einen Namen
auflösen. Entschieden am 2026-11-02: Die Edge stempelt den Namen in die Bestellung.

Der Name folgt einer späteren Umbenennung **nicht**. Das ist gewollt: Der Bon nennt die Kasse,
an der gebucht wurde. Personenbezug hat das Feld keinen, der Name gehört zum Gerät.

## Regeln am Edge

Umgesetzt im Create-Resolver `creationContext` (`apps/api-edge/src/services/orders/orders.schema.ts`,
`resolveCreationDevice`). Der Reihe nach:

1. **Split-Teilbeleg** (`orders.split`): erbt `createdVia` und `createdViaName` der Quelle über den
   serverseitigen Param `inheritCreationDevice`. Er gehört zum ursprünglichen Bon, nicht zur
   Kasse, die teilt. Fehlt der Quelle das Gerät (Bestandsbon), bleibt der Teilbeleg ohne. Der
   Bediener (`createdBy`) ist weiter der, der teilt.
2. **Pull-Apply** (`provider: undefined` und `fromSync: true`): Der Datensatz der Cloud gilt
   unverändert. Sonst verlöre eine Order, die zurückgezogen wird, ihren Snapshot still.
3. **Geräte-Session** (API-Key-Verbindung): Die Geräte-ID kommt aus `resolveActorDeviceId`
   (Payload `deviceId`, sonst `user._id` ohne `device:`). Der Name kommt per
   `devices.find({ query: { deviceId } })`, also über das Feld `deviceId` und nicht über `_id`.
   Body-Werte für beide Felder bleiben wirkungslos.
4. **Sonst** (JWT, interne Aufrufe): `createdVia` aus dem Body wie bisher, nie ein Name.

Die **konvertierte Vorbestellung** (`pre-orders.convert`) reicht die Params des Aufrufers durch und
bekommt so die Kasse, die konvertiert, denn dort wird gebucht.

Findet der Lookup kein Gerät oder schlägt er fehl, fehlt nur der Name. Die Bestellung entsteht
trotzdem, ein Fehler landet als `orders.creation_device_name_lookup_failed` im Log.

Der **Patch-Resolver** verwirft `creationContext` für jeden Aufrufer, auch für interne und den
Pull-Apply. `orderPatchSchema` ist `Type.Partial(orderSchema)` und ließe das Feld sonst durch. Der
Strip ist still: Der Aufrufer bekommt HTTP 200, der gespeicherte Wert bleibt.

Eine Migration braucht das Feld nicht: `creationContext` ist eine JSON-Textspalte
(`ORDER_JSON_FIELDS`).

## Sync und Cloud

Das Feld reist mit dem Order-Push unverändert in die Cloud. Gemessen am 2026-11-03: Die Cloud mit
gepinntem `@panary/orders@26.11.5` validiert eine Order mit `creationContext.createdViaName` über
ihren `dataValidator` (plain `new Ajv({})`) ohne Fehler und behält das Feld. `creationContextSchema`
trägt kein `additionalProperties: false`. Ein Edge-Release vor dem Pin-Bump der Cloud lässt den Push
also nicht scheitern (Outbox `rejected` wäre TERMINAL ohne Alarm). Ausgewertet wird das Feld in der
Cloud erst mit panary/panary-cloud#1072 und dem Pin-Bump dort.

## Grenzen

- Bestandsorders bleiben ohne Namen und meist ohne `createdVia`.
- Eine Edge mit altem Stand pusht weiter ohne die Felder.
- Ein offline erfasster Bon (`offlineCreated`) bekommt den Namen erst beim Replay über die Edge.
  Wird das Gerät dazwischen umbenannt, trägt er den neuen Namen.
