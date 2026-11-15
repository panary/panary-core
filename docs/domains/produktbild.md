---
type: Domain Concept
title: Produktbild — die Referenz imageAssetId am Produkt
description: 'Wie ein Produkt auf sein Bild verweist: das optionale, auf null setzbare Feld imageAssetId als uuid eines storefront-asset der Cloud, warum der Edge keine Spalte bekommt, die Reihenfolge für einen späteren Edge-Konsumenten und das Asset-Recht des Technikers.'
tags: [products, storefront, assets, sync, rbac]
status: stable
generated: { by: claude-code/sonnet-5.5, at: 2026-11-15T19:00:00Z }
---

# Produktbild — die Referenz `imageAssetId` am Produkt

Ein Produkt kannte bisher nur das Emoji-Feld `icon`. Produktbilder (Anker
[panary/panary-cloud#758](https://github.com/panary/panary-cloud/issues/758)) liegen als
`storefront-asset` in der Cloud; das Produkt trägt nur den Verweis darauf.

## Das Feld

`productSchema` in [`product.schema.ts`](../../libs/domains/products/domain/src/lib/product.schema.ts)
führt `imageAssetId`:

| Eigenschaft | Wert |
|---|---|
| Typ | `string` im Format `uuid` **oder** `null` |
| Pflicht | nein, Bestandsprodukte bleiben gültig |
| `null` | löst die Referenz per Patch. `$set` kann ein Feld nicht entfernen, und `$unset` lehnt das geschlossene Schema ab (wie beim Widerruf von `labeling`) |
| Anlegen | in der `Type.Pick`-Liste des `productDataSchema`, sonst lehnt `additionalProperties: false` es ab |
| Query | **kein** Filter, das Feld steht nicht in `productQueryProperties` |

Es ist ein Verweis und kein Binärfeld: Das Bild selbst, seine Größe und sein Format gehören dem
`storefront-asset` der Cloud.

## Warum der Edge keine Spalte bekommt

Das Feld folgt dem Muster von `labeling` ([ADR 0050](../adr/0050-deklaration-am-produkt.md)): Es ist ein
Cloud-Feld. [ADR 0070](../adr/0070-versions-kompatibilitaet-je-strecke.md) legt fest, dass neue Felder im
Sync-Vertrag erst in der Cloud und danach im Edge erscheinen, mit eigenem Release je Seite. Eine
vorbereitende Edge-Spalte machte den Edge neuer als die Cloud und schickte bei jedem Bootstrap
`imageAssetId: null`. Sie entsteht erst mit einem Edge-Konsumenten (Gast-Kiosk, Ausblick im Anker).

🚨 **Folge für die Cloud:** Sobald irgendein Schreibweg der Cloud das Feld setzt, muss sie es aus der
Pull-Projektion nehmen. Ein Edge lehnt den Datensatz sonst ab (vor diesem Release am geschlossenen
Schema, ab diesem Release an der fehlenden Spalte), der Cursor läuft weiter, und der Edge verpasst
jede spätere Änderung des Produkts, auch den Preis (ADR 0050, Konsequenz 1). Das sichert
[panary/panary-cloud#2081](https://github.com/panary/panary-cloud/issues/2081); der Upload im Katalog
([panary/panary-cloud#2084](https://github.com/panary/panary-cloud/issues/2084)) wartet darauf.

Setzt jemand das Feld direkt an der Edge-API, scheitert das Schreiben an der fehlenden Spalte. Das ist
derselbe Zustand wie bei `labeling`.

## Was ein späterer Edge-Konsument braucht

In dieser Reihenfolge, nach ADR 0050 Konsequenz 5 und ADR 0070:

1. Den Sync-Ingest-Schutz in der Cloud, deployt.
2. Eine Edge-Migration mit nullable Spalte `imageAssetId` (Muster
   `apps/api-edge/migrations/20260411000002_products-add-ingredient-references.ts`).
3. Einen Cursor-Reset für `products`, damit Produkte, die während des Strips ein Bild bekamen, im
   Delta ankommen.
4. Erst dann den Cloud-Strip aufheben, mit eigenem Release je Seite.

Reist das Feld später auch Edge → Cloud, gilt die Null-Clear-Falle aus ADR 0050: Die Cloud strippt
`null`, und ein Lösen am Edge spränge zurück.

## Asset-Recht für den Techniker

`TENANT_TECHNICIAN` darf Produkte verwalten, hatte aber kein Recht auf `storefront-asset` und hätte kein
Produktbild hochladen können. Die Matrix in
[`roles.matrix.ts`](../../libs/domains/users/domain/src/lib/roles.matrix.ts) gibt ihm jetzt `CREATE`,
`READ` und `DELETE` auf `storefront-asset`, wie dem `TENANT_MANAGER`, aber ohne `UPDATE`. In
[`rollen-matrix.md`](../security/rollen-matrix.md) zeigt die Spalte `tenant:technician` deshalb `CRD`.
Die Cloud bekommt die neue Matrix erst mit dem Pin-Bump.

`capability-bundles.ts` kennt keinen Storefront-Eintrag und bleibt unverändert.
