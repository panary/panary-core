---
type: Domain Concept
title: Modifier je Menü-Komponente (componentExternalId)
description: 'Wie ein Modifier, der im Bestelldialog zu einer Menü-Komponente gewählt wurde (Mayonnaise zur Pommes), diese Zuordnung als componentExternalId trägt, wie groupModifiersByComponent sie für Bon-Karte, Warenkorb, Historie und Druck auflöst und warum Preis, Steuer, Verbrauch und Bestandsbestellungen unverändert bleiben.'
tags: [orders, pos, printing, sync]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-26T21:50:00Z }
---

# Modifier je Menü-Komponente

Seit [core#1127](https://github.com/panary/panary-core/issues/1127). Vorher hingen bei einem Menü **alle** Modifier
flach an der Hauptzeile: Die Mayonnaise, die im Unterschritt „Pommes → Soßen“ gewählt wurde, stand auf Bon-Karte,
Bon und Küchenbon unter dem Burger.

## Das Feld

`modifierLineItemSchema.componentExternalId` (`libs/domains/orders/domain/src/lib/order.schema.ts`), optional,
`format: 'uuid'`. Es trägt die `externalId` der Komponente derselben Zeile, zu der der Modifier gewählt wurde:
`menuSideDish`, `menuDrink` oder ein `components[]`-Eintrag. **Fehlt das Feld, gehört der Modifier zum
Hauptartikel** — so lesen sich auch alle Bestandsbestellungen. Es gibt keinen Backfill, die Information existierte
vorher nicht.

`parentId` taugt nicht als Relation: Es wird an drei Stellen mit drei Bedeutungen befüllt (eigene `externalId`,
`externalId` der Zeile, Kategorie-ID).

Das Feld ist **reine Anzeige-Zuordnung**. `calculateModifierPrice`, `computeOrderTax` und `explodeOrderConsumption`
lesen es nicht; Modifier bleiben an derselben Zeile, Summen und Steuer sind bitgenau wie vorher. Die HIGHEST- und
Freimengen-Logik zählt weiter je `topic` über alle Modifier der Zeile.

### Zeilenidentität

`lineConfigKey` (`line-identity.ts`) nimmt das Feld in den Modifier-Schlüssel auf: Dieselbe Soße an Pommes und am
Burger ist eine andere Konfiguration. Praktisch wirkt das heute nicht, weil Menüs nie zusammengeführt werden
(`isMergeableLine`); es hält den Schlüssel aber ehrlich, falls Komponenten-Modifier einmal an anderen Zeilen auftauchen.

## Wer es setzt

Nur der Bestelldialog (`order-dialog.component.ts`): `selectOptionGroupItem` reicht die gewählte Komponente an den
Unterschritt weiter (`showOptionGroupButtons(subGroup, parent, selected.externalId)`). Modifier aus diesem Unterschritt
bekommen `componentExternalId`; direkt getippte Extras und Modifier aus den Gruppen des Menüs selbst bleiben ohne Feld.

- **Nur UUIDs.** Trägt die Komponente keine UUID als `externalId`, bleibt das Feld weg. Ein anderer Wert würde nach dem
  `@panary/orders`-Bump in der Cloud abgelehnt — als TERMINAL-Fehler in der Outbox.
- **Komponente ersetzt** (andere Beilage bzw. anderes Getränk): Die zugeordneten Modifier der alten Komponente fallen
  mit weg (`dropComponentModifiers`).
- **Extras-Raster und Anpassen-Sheet** passen nur den Hauptartikel an: `increaseExtra`/`decreaseExtra` und die
  Mengen im Sheet übergehen Modifier mit `componentExternalId`. Eine Mayo per Raster neben der Pommes-Mayo ist ein
  zweiter Eintrag ohne Zuordnung, Minus nimmt nie die Mayo der Pommes zurück.
- Der Legacy-Menüfluss (`setMenuSideDishSauce` → `increaseExtra`) setzt das Feld **nicht**; seine Soßen stehen weiter
  am Hauptartikel.
- Split: Menüs wandern als ganze Zeile, Teilmengen kopieren Modifier per Spread — das Feld reist in beiden Fällen mit.

## Wie es gelesen wird

`groupModifiersByComponent(line, { components? })` in `@panary/orders/domain` (`modifier-groups.ts`) ist die eine
Gruppierung für POS, Druck und Cloud:

| Gruppe | Auflösung |
|---|---|
| `sideDish` | Referenz = `menuSideDish.externalId` |
| `drink` | Referenz = `menuDrink.externalId` |
| `components[]` | Referenz = `externalId` eines Eintrags außer `role: 'main'`, in der Reihenfolge von `components[]` |
| `main` | kein Feld, oder eine Referenz, die die Zeile nicht auflöst |

Beilage und Getränk werden zuerst aufgelöst: Ein FIXED_PROPORTIONAL-Menü trägt sie in beiden Wegen mit derselben
`externalId`. Mit `{ components: false }` fallen Modifier reiner `components[]`-Komponenten auf den Hauptartikel —
für Leser, die `components[]` nicht ausgeben, sonst verschwänden sie still. `hasComponentModifiers` sagt, ob eine
Zeile überhaupt zugeordnete Modifier trägt.

- **Bon-Karte** (`active-orders`): Modifier je Komponente unter Beilage bzw. Getränk, `pl-6`, Preis in der
  Preisspalte ([Bon-Karte](pos-offene-bestellungen-bon-karte.md)).
- **Druck** (`order-receipt.renderer.ts`, `full` und `kitchen`): Trägt ein Menü zugeordnete Modifier, druckt es
  Burger → Burger-Modifier → Beilage → deren Modifier (zwei Zeichen weiter eingerückt, Preisspalte unverändert) →
  Getränk → deren Modifier. Ohne Zuordnung bleibt die Bestandsreihenfolge: Komponenten, dann alle Modifier.
- `components[]` druckt weder Karte noch Bon; beide rufen den Helfer mit `{ components: false }`.

- **Warenkorb des Bestelldialogs** (`order-dialog.component.html`, core#1218): `modifierGroups` ruft den Helfer mit
  `{ components: false }`. Hauptartikel-Extras stehen direkt unter dem Artikel, Beilage- und Getränk-Extras eine Stufe
  eingerückt (`pl-3`) unter ihrer Komponente, auch in der Kombination. Positionspreis und Summen bleiben unberührt.
  Seit [core#1234](https://github.com/panary/panary-core/issues/1234) tragen alle positiven Extras ein „+“ vor dem
  Namen („+ 2x Mayonaise“), „ohne“-Zeilen bleiben unverändert. Beim Einzelartikel stehen auch die
  Hauptartikel-Extras eingerückt (`pl-3`, wie in „Offen“); beim Menü bleibt die Anordnung wie oben.

- **Historie** (`order-history.component.html`, `history-line.ts`,
  [core#1235](https://github.com/panary/panary-core/issues/1235)): `buildHistoryLineVm` ruft den Helfer mit
  `{ components: false }`. Eine Vorlage für freie Positionen und Kombinationen zeigt den Hauptartikel mit „+ Name“,
  darunter Beilage und Getränk mit ihren Extras (eingerückt). „ohne“-Zeilen und −1-Marker bleiben ohne „+“, die Menge
  steht als „+ 2x Name“. Gespeicherte Preise, nichts wird neu gerechnet. Der Menü-Aufpreis der Komponenten entfällt:
  Die gespeicherte Zeile trägt keinen, und aus der aktuellen Standort-Konfiguration würde er für alte Bestellungen
  falsch. Die Historie liest weiter das rohe `order.lineItems` (nicht `effectiveLineItems` wie „Offen“), bei
  gesplitteten Bestellungen weichen beide bewusst voneinander ab.

Nicht umgestellt (zeigen weiter flach): Split-Dialog.

## Sync und Cloud

Die Cloud importiert das Order-Schema aus `@panary/orders` und validiert ohne `removeAdditional`; die Modifier-Ebene
hat kein `additionalProperties: false`. Vor dem Pin-Bump reicht sie das Feld ungeprüft durch, danach prüft sie es als
UUID. Die Cloud-Detailansicht zieht in [cloud#1468](https://github.com/panary/panary-cloud/issues/1468) nach.
Ob ein Edge mit dem Feld gegen eine Cloud mit altem Paket sauber synchronisiert, ist über die offene Modifier-Ebene
begründet, nicht in CI gemessen.
