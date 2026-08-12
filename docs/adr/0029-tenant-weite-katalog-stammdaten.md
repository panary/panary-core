---
type: ADR
title: Tenant-weite Katalog-Stammdaten — locationId null für Produkte und Produktgruppen
description: Produkte und Produktgruppen dürfen locationId null tragen und sind damit für jede Filiale des Mandanten sichtbar; erzeugt werden sie ausschließlich in der Cloud, der Edge-Schreibpfad bleibt filialgebunden.
tags: [catalog, multi-tenancy, sync, products, product-groups]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-12T20:00:00Z }
---

# Tenant-weite Katalog-Stammdaten (`locationId: null`)

## Problem

panary/panary-cloud#217 will Stammdaten in einer **Hauptfiliale** pflegen und von dort auf die
übrigen Filialen ausrollen. Zwei Topologien müssen funktionieren: Filiale = eigener Tenant (A)
und Filiale = `locationId` innerhalb eines Tenants (B). Für B braucht der Import einen
Ziel-Scope, und einer der beiden sinnvollen Scopes ist „tenant-weit" — ein Datensatz, den
**alle** Filialen sehen, statt N Kopien mit derselben `externalId`.

Für Produkte und Produktgruppen war dieser Scope an zwei unabhängigen Stellen versperrt:

| Stelle | Zustand vorher |
|---|---|
| Schema | `locationId: Type.String({ format: 'uuid' })` — ein Create mit `null` scheiterte an `validateData` (`/locationId: Expected string`) |
| Edge-Sichtbarkeit | `multiTenancy({ isolateLocation: true, allowGlobalData: false })` — der Read-Filter setzt `query.locationId = <Edge-Filiale>` hart |

Die zweite Stelle wiegt schwerer als die erste: Selbst mit nullable Schema wäre ein
tenant-weites Produkt am POS **unsichtbar** gewesen — „ausgerollt, aber nicht da", ohne jede
Fehlermeldung. Ein reiner Cloud-Fix hätte diesen Zustand erzeugt.

Zutaten, Rezepturen und Preislisten sind nicht betroffen: Ihre Schemas führen `locationId`
längst als `Type.Optional(Type.Union([Type.String(), Type.Null()]))`, und am Edge existieren
diese Services gar nicht (cloud-only).

## Entscheidung

`locationId` wird in `productSchema` und `productGroupSchema` auf
`Type.Union([Type.String({ format: 'uuid' }), Type.Null()])` erweitert, und beide Edge-Services
laufen mit `allowGlobalData: true`. Das ist exakt das Muster, das `discounts` im selben Repo
bereits fährt (`libs/domains/discounts/domain/src/lib/discount.schema.ts`).

Drei Grenzen bleiben bewusst bestehen:

1. **`locationId` bleibt im DATA-Schema Pflicht.** Zulässig wird nur ein *explizites* `null`,
   nicht ein *fehlendes* Feld. `assert-stamp-fields.ts` führt genau dieses `required` als
   einzigen Schutz davor, dass der Pull-Apply — der ohne `user` und damit ohne Stempel läuft —
   einen defekten Cloud-Record still mit NULL in die Edge-DB schreibt. Ein lauter
   REJECTED-Eintrag im `sync-runs`-Detail ist die bessere Diagnose als ein unsichtbares Produkt.
2. **Der Edge-WRITE-Stempel bleibt filialgebunden.** `stampEdgeDefaults` überschreibt ein
   explizites `locationId: null` weiterhin mit der Filiale des Bedieners (truthy-basiert, per
   Spec gelockt). Tenant-weite Datensätze entstehen ausschließlich in der Cloud und kommen per
   Sync-Pull an den Edge; ein Edge-Client kann sie nicht anlegen.
3. **Tenant-weit heißt nicht mandantenübergreifend.** Der `tenantId`-Filter ist ein harter
   Filter vor der Location-Verfeinerung und bleibt unangetastet.

Der Sync-Pull braucht keine Änderung: `products` und `product-groups` haben keinen Eintrag in
`PULL_STRATEGIES` (panary-cloud `sync-pull-strategies.ts`), der Basisfilter ist `{ tenantId }`
ohne Location-Verfeinerung. Tenant-weite Datensätze werden also ohnehin mitgeliefert — bisher
hat sie nur der Edge-Read-Filter wieder weggefiltert. Auch die Edge-SQLite bleibt unverändert:
`locationId` ist in beiden Tabellen bereits `.nullable()` (`20260219000004_product_groups.ts`,
`20260219000005_products.ts`).

## Konsequenzen

**Die Änderung ist bis zum ersten tenant-weiten Datensatz wirkungslos.** `allowGlobalData: true`
ergänzt nur einen zweiten `$or`-Zweig; ohne `locationId: null`-Records läuft er leer. Genau
deshalb ist core-zuerst die richtige Reihenfolge: Der Rollout dieses Tags ändert an keiner
laufenden Kasse etwas, und die Cloud-Seite kann erst danach überhaupt tenant-weite Datensätze
erzeugen.

`Product['locationId']` und `ProductGroup['locationId']` sind ab jetzt `string | null`. Der
Typecheck-Fallout in diesem Repo war leer (api-edge, pos-client, admin-client bauen
unverändert); Konsumenten in panary-cloud sehen den neuen Typ mit dem nächsten Pin-Bump.

Was **nicht** entschieden ist: ob eine Filiale einen tenant-weiten Datensatz lokal übersteuern
darf (derselbe `externalId` einmal mit `locationId: null` und einmal filialgebunden). Der
Read-Filter würde dann beide liefern, und welcher gewinnt, wäre undefiniert. Solange der
Katalog-Rollout je `externalId` genau einen Scope schreibt, tritt der Fall nicht ein — eine
Absicherung dagegen gehört in die Cloud (panary/panary-cloud#217), nicht hierher.

## Verifikation

`apps/api-edge/test/services/products/tenant-wide-products.test.ts` prüft gegen die volle
Hook-Kette: tenant-weites Produkt anlegbar und für den Filial-Mitarbeiter sichtbar,
Nachbarfiliale weiterhin unsichtbar, fremder Mandant weiterhin unsichtbar, fehlendes
`locationId` weiterhin abgelehnt, externer Create weiterhin filialgebunden gestempelt.
