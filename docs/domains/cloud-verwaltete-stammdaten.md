---
type: Domain Concept
title: 'Cloud-verwaltete Stammdaten am Edge — welche Services nach dem Pairing read-only sind'
description: 'Übersicht der Edge-Services, deren Source of Truth nach dem Pairing die Cloud ist: der cloudManaged()-Hook sperrt externe Writes, der Sync-Pull bleibt offen, der Edge-Admin zeigt den Zustand an. Dazu die Regel, wann ein Service hierher gehört, und die einzige Ausnahme (Notfall-Modus für Drucker).'
tags: [sync, edge, cloud-connection, products, customers, security]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-05T15:50:00Z }
---

# Cloud-verwaltete Stammdaten am Edge

Nach dem Pairing ist die Cloud **Source of Truth** für Stammdaten ([ADR 0001](../adr/0001-emergency-override.md),
„Cloud-zentrales Stammdaten-Modell"). Der Edge bekommt sie per **Pull** und schickt
**nur Transaktionen** nach oben (`SyncableTransactionService`: Bestellungen, Belege, Arbeitszeiten …).
Eine Stammdaten-Änderung am gepairten Edge erreicht die Cloud deshalb nie. Beim nächsten Pull
desselben Datensatzes wird sie still überschrieben, bis dahin laufen Kasse und Cloud auseinander.

Verhindert wird das an einer einzigen Stelle: dem `cloudManaged()`-Hook
(`apps/api-edge/src/hooks/cloud-managed.hook.ts`).

## Welche Services gesperrt sind

| Service | Hook | Besonderheit |
|---|---|---|
| `locations` | `cloudManaged()` | Notfall-Modus: reine `settings.printSettings`-Patches erlaubt ([ADR 0001](../adr/0001-emergency-override.md)) |
| `opening-hour-exceptions` | `cloudManaged()` | — |
| `discounts` | `cloudManaged()` | siehe [Rabatte](rabatte.md) |
| `tenants` | `cloudManaged()` | Projektion, siehe [Tenant-Edge-Replica](tenant-edge-replica.md) |
| `products` | `cloudManaged()` | seit [#607](https://github.com/panary/panary-core/issues/607) |
| `product-groups` | `cloudManaged()` | seit [#607](https://github.com/panary/panary-core/issues/607) |
| `customers` | `cloudManaged()` | seit [#620](https://github.com/panary/panary-core/issues/620) |
| `corporate-customers` | `cloudManaged()` | seit [#620](https://github.com/panary/panary-core/issues/620) |
| `businessdays` | eigener `cloudManagedHook` | Lebenszyklus, siehe [Verwaiste Geschäftstage](verwaiste-geschaeftstage.md) |

`products` und `product-groups` fehlten bis #607: Der Edge-Admin ließ Produkte nach dem Pairing
umbenennen, die Änderung wirkte an der Kasse und erschien nie in der Cloud (beobachtet im Sichttest
panary/panary-cloud#670).

## Was der Hook sperrt und was nicht

- **Gesperrt:** `create`, `update`, `patch`, `remove` mit gesetztem `provider` (REST, Socket), solange
  eine `cloud-connection` mit `pairingStatus: connected` existiert. Antwort: `403` mit
  `data.code = 'CLOUD_MANAGED'`.
- **Offen:** alle Reads, und jeder interne Aufruf (`provider: undefined`). So schreiben Sync-Pull,
  Bootstrap und Konfliktauflösung; sie würden sonst selbst geblockt.
- **Offen ohne Pairing:** Ein Standalone-Edge pflegt seine Stammdaten selbst (Setup, Recovery).
- **Fail-open**, wenn `cloud-connection` nicht lesbar ist (erster Boot vor der Registrierung).

Die Reihenfolge im Service ist `authenticate → authorize → cloudManaged → multiTenancy`. Ein
Write ohne Rechte scheitert also weiter mit dem Rechte-Fehler, nicht mit `CLOUD_MANAGED`.

## Wann ein Service hierher gehört

Ein Edge-Service braucht `cloudManaged()`, wenn er in `SyncableMasterDataService`
(`libs/domains/edge-pairing/domain/src/lib/edge-pairing-request.schema.ts`) steht und **nicht** in
`SyncableTransactionService`. Dann gibt es keinen Weg Edge → Cloud außer dem Bootstrap.
`users` steht in beiden Listen (PIN-Wechsel am POS wird live gepusht) und ist deshalb nicht gesperrt.
`customers` und `corporate-customers` bekamen den Hook mit
[#620](https://github.com/panary/panary-core/issues/620): Kein Edge-UI schreibt auf sie, offen war der
REST-/Socket-Write mit gültigem Token. Soll die Kasse später Kunden anlegen, gehören sie als
Edge→Cloud-Push modelliert (Transaction-Service plus Cloud-Allowlist), nicht durch Entfernen des Hooks.

Ein neuer Master-Data-Service ohne Hook wiederholt #607. Der Integrationstest
`apps/api-edge/test/services/products/cloud-managed-products.test.ts` ist die Vorlage für den Nachweis
gegen die volle Hook-Kette. Eine Spec des Hooks allein sieht die fehlende Registrierung nicht.

## Edge-Admin

`CloudManagedService` (`apps/admin-client/src/app/core/cloud-managed.service.ts`) spiegelt den Zustand
aus `/health`. Gesperrte Seiten zeigen den `app-cloud-managed-banner` und schalten das Formular per
`<fieldset [disabled]>` ab. Für Produkte und Produktgruppen sind zusätzlich Neu, Import und Assistent
ausgeblendet; Export bleibt. Ein `CLOUD_MANAGED` vom Backend löst ein sofortiges `refresh()` aus, damit
die Seite nicht bis zum nächsten 60-s-Poll editierbar aussieht.

## Kein Notfall-Modus für Produkte

Der Notfall-Modus bleibt auf Drucker begrenzt: Nur dort ist eine Änderung hardwarebedingt akut, und nur
dort gibt es einen Abgleichpfad (`pending-local-overrides` → `POST /sync-reconcile-overrides`). Ein
Produkt-Override (etwa „ausverkauft" während eines Cloud-Ausfalls) bräuchte einen eigenen Abgleich und
wäre ein eigenes Vorhaben (Entscheidung 2026-10-05, #607).
