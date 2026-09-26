---
type: Domain Concept
title: Allergen- und Zusatzstoff-Deklaration am Produkt
description: 'Wie ein Produkt seine Allergene und Zusatzstoffe trägt: das Feld labeling mit drei Zuständen, der Zusatzstoff-Katalog nach § 5 LMZDV, Widerruf und Server-Stempel, warum der Edge das Feld vorerst nicht bekommt und was rechtlich offen bleibt.'
tags: [products, allergens, storefront, sync]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-09-25T23:50:00Z }
---

# Allergen- und Zusatzstoff-Deklaration am Produkt

Wer loses Essen per Fernabsatz verkauft — also eine Vorbestellung über die Storefront annimmt —,
muss Allergene und Zusatzstoffe je Gericht **vor Vertragsschluss** angeben. Das Produkt trägt
dafür eine vom Betrieb bestätigte Deklaration. Warum sie so gebaut ist und nicht anders:
[ADR 0050](../adr/0050-deklaration-am-produkt.md).

Die Kette über beide Repos: [#393](https://github.com/panary/panary-core/issues/393) (dieses
Schema) → Release → [panary/panary-cloud#549](https://github.com/panary/panary-cloud/issues/549)
(Pflege im Admin, Sync-Schutz) → [panary/panary-cloud#550](https://github.com/panary/panary-cloud/issues/550)
(Anzeige auf der Speisekarte) → [panary/panary-cloud#551](https://github.com/panary/panary-cloud/issues/551)
(Bestellannahme nur für deklarierte Gerichte).

## Das Feld

`labeling` am `productSchema`
([`product.schema.ts`](../../libs/domains/products/domain/src/lib/product.schema.ts)), optional,
`null` zulässig. Das Objekt ist geschlossen (`additionalProperties: false`).

| Feld | Typ | Regel |
|---|---|---|
| `allergens` | `Allergen[]` | Pflicht. Codes aus `ALLERGENS` (14 nach Anhang II LMIV), keine Dubletten |
| `additives` | `Additive[]` | Pflicht. Codes aus `ADDITIVES` (13 nach § 5 Abs. 1 LMZDV), keine Dubletten |
| `declaredAt` | ISO 8601 | optional — setzt der Server beim Bestätigen |
| `declaredBy` | UUID | optional — der bestätigende User, setzt der Server |

Ein Patch ersetzt die Deklaration nur **als Ganzes**. `{ labeling: { allergens: ['MILK'] } }`
lehnt das Schema ab: Eine Deklaration sagt immer etwas über beide Listen aus.

## Drei Zustände

| `labeling` | Zustand | `getProductLabelingState()` |
|---|---|---|
| fehlt oder `null` | nicht deklariert | `UNDECLARED` |
| `{ allergens: [], additives: [] }` | deklariert, nichts Kennzeichnungspflichtiges | `DECLARED_NONE` |
| mindestens ein Code | deklariert mit | `DECLARED` |

```ts
import { getProductLabelingState } from '@panary/products/domain'

getProductLabelingState(product.labeling) // 'UNDECLARED' | 'DECLARED_NONE' | 'DECLARED'
```

Den Zustand nie selbst ableiten: Das Fehlen trägt jedes Bestandsprodukt, `null` jedes
widerrufene. Eine Prüfung nur auf `=== undefined` zeigt ein widerrufenes Gericht als deklariert
an ([`product-labeling.ts`](../../libs/domains/products/domain/src/lib/product-labeling.ts)).

Alle Bestandsprodukte starten **nicht deklariert**. Eine Übernahme aus den Zutaten gibt es
bewusst nicht; die Cloud bietet sie nur als Vorschlag an.

## Widerruf und Server-Stempel

- **Widerruf:** `patch(id, { labeling: null })`. In der Cloud wirkt das nur mit
  `nullableFields: ['labeling']` am Produkt-Service — ohne den Eintrag entfernt der Null-Strip das
  `null` vor der Validierung, und der Patch ändert nichts
  ([ADR 0050, Konsequenz 3](../adr/0050-deklaration-am-produkt.md#konsequenzen)).
- **Stempel:** `declaredAt` und `declaredBy` setzt der Server. Sie sind im Schema optional, weil
  `validateData` vor dem stempelnden Hook läuft. Dass eine bestätigte Deklaration ein Datum trägt,
  sichert deshalb der Hook, nicht AJV.

## Zusatzstoff-Katalog

`ADDITIVES` und `ADDITIVE_CATALOG` in
[`additive.enum.ts`](../../libs/domains/allergens/domain/src/lib/additive.enum.ts). Ein Code steht
für eine **Angabe** nach § 5 Abs. 1 LMZDV, nicht für einen einzelnen Stoff. Der Katalog führt je
Code die Pflichtangabe (`label`), den Anwendungsfall im Wortlaut der Verordnung (`appliesTo`) und
die Fundstelle (`legalBasis`).

| Code | Pflichtangabe | Fundstelle |
|---|---|---|
| `COLOURING` | mit Farbstoff | Nr. 1 |
| `PRESERVATIVE` | mit Konservierungsstoff (wahlweise „konserviert") | Nr. 2 |
| `ANTIOXIDANT` | mit Antioxidationsmittel | Nr. 3 |
| `NITRITE_CURING_SALT` | mit Nitritpökelsalz | Nr. 4 a |
| `NITRATE` | mit Nitrat | Nr. 4 b |
| `NITRITE_CURING_SALT_AND_NITRATE` | mit Nitritpökelsalz und Nitrat | Nr. 4 c |
| `FLAVOUR_ENHANCER` | mit Geschmacksverstärker | Nr. 5 |
| `BLACKENED` | geschwärzt (Oliven) | Nr. 6 |
| `WAXED` | gewachst (frisches Obst und Gemüse) | Nr. 7 |
| `PHOSPHATE` | mit Phosphat (Fleischerzeugnisse) | Nr. 8 |
| `SWEETENER` | mit Süßungsmittel(n) | Nr. 9 |
| `PHENYLALANINE_SOURCE` | enthält eine Phenylalaninquelle | Nr. 11 |
| `LAXATIVE_POLYOLS` | kann bei übermäßigem Verzehr abführend wirken | Nr. 12 |

- **Nr. 4 a bis c** dürfen die Angaben nach Nr. 2 und 3 wahlweise ersetzen. Das Schema hindert
  niemanden, beides zu wählen.
- **Nr. 10 fehlt bewusst.** Tafelsüßen brauchen „auf der Grundlage von …" plus die Namen der
  Süßungsmittel als Freitext, und sie sind kein zubereitetes Gericht.
- **„geschwefelt" gibt es nicht.** § 5 LMZDV kennt die Angabe nicht; Sulfite deckt das Allergen
  `SULPHITES` ab.
- **§ 5 Abs. 3 LMZDV** lässt die Angaben Nr. 1 bis 8 unter anderem entfallen, wenn ein
  Zutatenverzeichnis nach Art. 18 LMIV vorliegt oder alle Zusatzstoffe mit Klasse und Name bzw.
  E-Nummer in einem Aushang oder leicht zugänglichen Informationsangebot stehen. Panary bildet nur
  die Klassenangaben ab.

Stand des Wortlauts: BGBl. 2026 I Nr. 243, abgeglichen am 2026-09-26. Ändert sich die
Verordnung, sind Katalog **und** Spec (`additive.enum.spec.ts`, führt den Wortlaut ein zweites
Mal) nachzuziehen — gegen den Text auf gesetze-im-internet.de, nicht aus dem Gedächtnis.

## Edge und Sync

- **Der Edge hat keine Spalte `labeling`.** Das Schema kennt das Feld, die Tabelle nicht: Ein
  Client, der es am Edge schickt, liefe in einen SQL-Fehler. Heute tut das keiner.
- **Die Cloud hält das Feld vom Edge fern** — sie nimmt es aus der Pull-Projektion, bevor ein
  Schreibweg es setzt (panary/panary-cloud#549). Ohne diesen Strip scheitert der Pull still an
  alten Edges (Schema-Ablehnung) und an neuen (fehlende Spalte), und der Cursor läuft weiter.
- **Der Sync-Ingest darf das Feld weder setzen noch löschen** (ebenfalls panary/panary-cloud#549).
- Was ein späterer Edge-Konsument braucht, in welcher Reihenfolge:
  [ADR 0050, Konsequenz 5](../adr/0050-deklaration-am-produkt.md#konsequenzen).

## Grenzen

Was Tests und CI hier grundsätzlich nicht belegen:

- **Rechtliche Vollständigkeit.** Die Specs halten den abgeglichenen Wortlaut fest, nicht, dass
  der Katalog alle Pflichten erfasst. Nicht geprüft ist etwa, ob für lose Ware weitere
  Pflichthinweise außerhalb von § 5 LMZDV gelten, zum Beispiel für einzelne Farbstoffe nach
  Anhang V der Verordnung (EG) Nr. 1333/2008.
- **Deutsche Allergen-Bezeichnungen fehlen.** Für Allergene gibt es nur Codes, weder core noch
  cloud führt eine Bezeichnung nach Anhang II LMIV. Der Admin zeigt heute die Codes roh
  (`GLUTEN`, `CRUSTACEANS`). Die Legende auf der Speisekarte (panary/panary-cloud#550) braucht
  sie. Offen ist, ob sie als Katalog wie `ADDITIVE_CATALOG` nach core gehören oder in die
  Cloud-Übersetzungen.
- **Getreideart und Schalenfrucht.** Die Bekanntmachung der Kommission 2017/C 428/01 verlangt für
  das Zutatenverzeichnis die konkrete Getreideart (Nr. 8: Weizen, Roggen, Gerste, Hafer) und die
  konkrete Schalenfrucht (Nr. 13: Mandeln, Haselnüsse …). Für lose Ware regelt Deutschland die
  Form in § 4 LMIDV, der für den Inhalt auf Art. 9 Abs. 1 Buchst. c LMIV verweist. Ob `GLUTEN`
  und `NUTS` als Klassenangabe genügen, ist hier **nicht geklärt** — vor dem Einschalten der
  Bestellannahme (panary/panary-cloud#551) klären. Eine Verfeinerung wäre additiv, zum Beispiel
  eigene optionale Listen am Feld, und bräche nichts.
- **Richtigkeit.** Ob eine Deklaration stimmt, prüft kein System — das verantwortet der Betrieb.
