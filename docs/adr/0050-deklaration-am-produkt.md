---
type: ADR
title: 'Allergene und Zusatzstoffe werden am Produkt deklariert — bestätigt, nicht abgeleitet, im core-Schema'
description: 'ADR zur Allergen- und Zusatzstoff-Deklaration als optionales Feld labeling am Produkt: drei Zustände, Zusatzstoff-Katalog nach § 5 LMZDV, Widerruf per null, Server-Stempel optional, core statt cloud-lokal, und warum der Edge das Feld vorerst weder speichert noch bekommt.'
tags: [products, allergens, sync, storefront]
status: stable
decision: accepted
implementation: 'Schema umgesetzt 2026-09-26 (#393), noch ohne Release. Pflege folgt mit panary/panary-cloud#549, Anzeige mit panary/panary-cloud#550, Bestellannahme mit panary/panary-cloud#551.'
generated: { by: claude-code/opus-5.5, at: 2026-09-25T23:45:00Z }
sources:
  - { id: lmzdv-5, resource: 'https://www.gesetze-im-internet.de/lmzdv/__5.html', title: '§ 5 LMZDV — Kennzeichnung' }
  - { id: lmidv-4, resource: 'https://www.gesetze-im-internet.de/lmidv/__4.html', title: '§ 4 LMIDV — nicht vorverpackte Lebensmittel' }
  - { id: kom-2017-c428, resource: 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:52017XC1213(01)', title: 'Bekanntmachung der Kommission 2017/C 428/01 zu Allergenangaben' }
---

# Allergene und Zusatzstoffe werden am Produkt deklariert

## Problem

Die Storefront soll je Gericht Allergene und Zusatzstoffe zeigen. Beim Fernabsatz loser Ware ist
das vor Vertragsschluss Pflicht — für Allergene nach Art. 14 Abs. 2 i. V. m. Art. 44 LMIV, für
Zusatzstoffe nach § 5 Abs. 2 Nr. 3 LMZDV, der auf Art. 14 Abs. 1 LMIV verweist. Sobald ein Betrieb
über die Storefront vorbestellen lässt, fehlt also eine Pflichtangabe.

Das Modell gab sie nicht her:

- Allergene gibt es nur an der **Zutat**: `allergensManual` und das daraus plus aus den
  Lieferantenprodukten berechnete `allergens` (`libs/domains/ingredients/domain/src/lib/ingredient.schema.ts`).
- Das **Produkt** trägt nichts. `ingredientReferences`/`recipeReferences` führen Name und Menge
  für den **Wareneinsatz**, nicht für die Kennzeichnung.
- **Zusatzstoffe** kommen im Modell nirgends vor.

Anlass war panary/panary-cloud#539: Zwei Speisekarten-Themes kündigten eine Allergenliste an, die
es nicht gab. Offen waren drei Fragen — woher die Angabe kommt, wo sie liegt und wie sie reist.

## Entscheidung

### 1. Der Betrieb bestätigt die Deklaration — sie wird nicht abgeleitet

Zutaten und Rezeptur liefern nur einen **Vorschlag** (panary/panary-cloud#549), gespeichert wird,
was der Betrieb bestätigt. Eine Ableitung wäre in der gefährlichen Richtung falsch: Die
Wareneinsatz-Referenzen sind oft unvollständig, und die Allergen-Pflege an der Zutat ist optional
(laut panary/panary-cloud#549 Onboarding-Schritt `ingredients`, `mandatory: false`). Eine fehlende
Referenz ergäbe still ein „frei von". Entscheidung Michael, 2026-09-25.

### 2. Drei Zustände über ein optionales Feld

```ts
labeling?: { allergens: Allergen[]; additives: Additive[]; declaredAt?: string; declaredBy?: string } | null
```

| `labeling` | Zustand | `getProductLabelingState()` |
|---|---|---|
| fehlt oder `null` | nicht deklariert | `UNDECLARED` |
| beide Listen leer | deklariert, nichts Kennzeichnungspflichtiges | `DECLARED_NONE` |
| mindestens ein Eintrag | deklariert mit | `DECLARED` |

„Leere Liste = nicht deklariert" hätte „geprüft, nichts drin" und „nie angesehen" ununterscheidbar
gemacht — genau das tut die Allergen-Karte der Zutat heute, und für ein Gericht reicht es nicht.
**Beide Listen sind Pflicht**, weil eine Deklaration immer über beides etwas sagt; eine Liste
allein wäre wieder ein halber Zustand. Beide sind `uniqueItems` und gegen geschlossene Kataloge
geprüft.

`getProductLabelingState()` in `@panary/products/domain` ist die **eine** Stelle, die den Zustand
ableitet. Es gibt zwei Formen für „nicht deklariert" (siehe 4) — wer nur `=== undefined` prüft,
zeigt ein widerrufenes Gericht als deklariert an.

### 3. Zusatzstoffe als Katalog der Pflichtangaben nach § 5 Abs. 1 LMZDV

`ADDITIVES` in `@panary/allergens/domain` neben `ALLERGENS`, dazu `ADDITIVE_CATALOG` mit
Pflichtangabe, Anwendungsfall und Fundstelle je Code. Ein Code steht für eine **Angabe**
(„mit Farbstoff"), nicht für einen Stoff — die Verordnung verlangt bei loser Ware die Klasse, keine
E-Nummer.

- **13 Codes:** Nr. 1 bis 12, Nr. 4 in a bis c geteilt (die wahlweise Nr. 2 und 3 ersetzen dürfen).
- **Nr. 10 fehlt bewusst:** Tafelsüßen brauchen „auf der Grundlage von …" plus die Namen der
  Süßungsmittel als Freitext, und sie sind kein zubereitetes Gericht.
- **Kein „geschwefelt":** § 5 LMZDV kennt die Angabe nicht. Sulfite deckt das Allergen
  `SULPHITES` ab (Anhang II Nr. 12 LMIV).

Wortlaut und Anwendungsfall sind am 2026-09-26 maschinell gegen den Verordnungstext abgeglichen
(Stand BGBl. 2026 I Nr. 243): 13 von 13 Angaben wörtlich, jede mit dem Anwendungsfall aus derselben
Nummer gepaart. Die Spec führt den Wortlaut ein zweites Mal — wer eine Angabe ändert, ändert sie an
zwei Stellen.

### 4. Widerruf per `null`

„Zurück auf nicht deklariert" ist ein Patch mit `labeling: null`. Der Mongo-Adapter schreibt per
`$set` und kann ein Feld nicht entfernen; `$unset` lehnt das geschlossene Schema ab. Eine eigene
Custom Method wäre Schutzschicht-Arbeit ([ADR 0046](0046-eigentums-check-fuer-custom-methods.md))
für einen Zustandswechsel, den ein Patch ausdrücken kann. Der Preis sind die zwei Formen aus 2.

### 5. `declaredAt` und `declaredBy` sind optional — der Server stempelt sie

Abweichung von der Plan-Skizze in #393, dort war `declaredAt` Pflicht. Laut panary/panary-cloud#549
setzt der Server beide Werte, nie der Client, und `validateData` läuft **vor** dem stempelnden
Resolver. Als Pflichtfeld lehnte AJV deshalb jede Bestätigung mit „must have required property"
ab, solange der Stempel nicht in `customPreValidationHooks` sitzt. Das ist die Hausregel für
Server-Felder: im Schema optional, die Pflicht im Hook. Eine Schema-Invarianten-Spec hält fest,
dass nur die beiden Listen in `required` stehen.

`declaredBy` ist `format: 'uuid'` wie `userSchema._id`.

### 6. Das Feld liegt im core-Schema, nicht cloud-lokal

Heute liest und schreibt es nur die Cloud — die Prüffrage „braucht der Edge das Feld wirklich?"
spräche also für cloud-lokal, und panary-cloud ADR 0002 ließe eine Cloud-Erweiterung per
`Type.Intersect` zu. Entschieden ist trotzdem core (Michael, 2026-09-25):

- core ist nach panary-cloud ADR 0002 die Single Source of Truth der Katalog-Schemas, und die
  Deklaration ist Stammdatum des Produkts, kein Buchhaltungswert der Cloud.
- Der absehbare Konsument ist der POS. Mit dem Feld im core-Schema braucht er später nur Spalte
  und Sync-Freigabe, keine Schema-Migration über zwei Repos.
- Der eingeübte cloud-lokale Weg — Schreiben per `_patch` am Schema vorbei — passt hier nicht:
  `_patch` umgeht `validateData`, die Deklaration kommt aber als Nutzereingabe aus dem Admin und
  muss gegen die Kataloge geprüft werden.

⚠️ Die ersten beiden Punkte sind die im Issue vorgeschlagene Begründung. Michael hat die
Entscheidung getroffen; ob das seine Gründe sind, bestätigt er beim Lesen.

### 7. Keine Edge-Spalte und kein Query-Feld

**Keine Edge-Spalte:** Mit Spalte schickte der Edge bei jedem Produkt-Push das Feld als `null`,
weil ungesetzte nullable Spalten als `null` reisen — und löschte die Cloud-Deklaration, solange der
Sync-Ingest das nicht sperrt. Ohne Spalte schickt er das Feld gar nicht. Der Preis: Das Schema kennt
ein Feld, das die Edge-Tabelle nicht speichern kann. Ein Client, der es am Edge schickt, liefe in
einen SQL-Fehler. Heute tut das keiner — der Edge-Admin patcht mit seinem eigenen Formularmodell
(`apps/admin-client/src/app/features/products/product-form.ts`, `onSave()`).

**Kein Query-Feld:** `querySyntax` über verschachtelte Objekte läuft in TS2589, und kein Konsument
braucht einen Server-Filter. Die Bestellannahme (panary/panary-cloud#551) soll je Warenkorb-Zeile
im Code prüfen — `buildStorefrontCart()` löst jede Zeile ohnehin gegen `products` auf —, und die
Readiness-Liste rechnet im Frontend. Braucht es später einen Filter, dann als flache
Dot-Property (`'labeling.declaredAt'`) nach dem `querySyntax`-Muster aus `order.schema.ts`. Die
Spec hält fest, dass `labeling` heute als Filter abgelehnt wird.

## Konsequenzen

1. 🚨 **Die Cloud muss `labeling` aus der Pull-Projektion nehmen, bevor irgendein Schreibweg es
   setzt** (erster Schritt von panary/panary-cloud#549). Ohne Strip scheitert der Pull an **beiden**
   Edge-Ständen, und zwar still:
   - Ein Edge **vor** diesem Release lehnt den Datensatz terminal ab (`additionalProperties: false`).
   - Ein Edge **ab** diesem Release akzeptiert das Schema, aber das Schreiben ohne Spalte scheitert:
     Der Edge-Adapter ist ein `KnexService` ohne Spaltenfilter. Gemessen mit Knex und
     better-sqlite3: `SQLITE_ERROR … no such column: labeling`, und zwar für die **ganze** Zeile —
     die übrigen Felder im selben Update wurden ebenfalls nicht geschrieben.

   In beiden Fällen läuft der Pull-Cursor weiter. Der Edge verpasst danach jede Änderung genau
   dieses Produkts, auch den Preis.
   `_deletedAt` wird aus demselben Grund auf **beiden** Seiten gestrippt
   (`apps/api-edge/src/workers/sync-apply.ts`). Für `labeling` ist nur der Cloud-Strip geplant —
   ein zusätzlicher Edge-Strip nach diesem Muster schützte neue Edges auch gegen eine Cloud, die
   den Strip vergisst. Er ist in diesem Schritt bewusst nicht gebaut.
2. **Der Sync-Ingest (`fromSync`) darf `labeling` weder setzen noch löschen** (panary/panary-cloud#549).
3. 🚨 **Der Widerruf braucht in der Cloud `nullableFields: ['labeling']`.** Der Produkt-Service fährt
   `stripNullPayload: true` ohne eigene `nullableFields` (`apps/api-cloud/src/services/products/products.ts`,
   gemessen an `origin/main` @ `3b125ecd`). Ohne den Eintrag entfernt der Null-Strip `labeling: null`
   vor der Validierung — der Widerruf wird mit 200 quittiert und ändert nichts.
4. **Die Pflicht zu `declaredAt`/`declaredBy` liegt im Cloud-Hook.** Stempelt er im Resolver, reicht
   das, weil beide optional sind; eine Bestätigung ohne Datum verhindert nur der Hook. Bei externen
   Schreibzugriffen muss er beide Werte **überschreiben**, nicht nur ergänzen — das Schema nimmt
   Client-Werte an, ein Client könnte sonst ein beliebiges Datum oder eine fremde User-ID eintragen.
   Interne Kopien (`duplicate()`) übernehmen die Werte des Masters bewusst.
5. **Was ein späterer Edge-Konsument braucht, in dieser Reihenfolge:**
   1. Den Sync-Ingest-Schutz aus 2 in der Cloud, deployt.
   2. Eine Edge-Migration mit nullable Spalte `labeling` nach Muster
      `apps/api-edge/migrations/20260411000002_products-add-ingredient-references.ts`.
   3. `labeling` in `PRODUCT_JSON_FIELDS` (`apps/api-edge/src/services/products/products.ts`).
   4. Einen Cursor-Reset für `products` — Produkte, die während des Strips deklariert wurden,
      kommen im Delta sonst nie an (Muster der Migrationen in v26.7.35/v26.7.36).
   5. Erst dann den Cloud-Strip aufheben.

   Reist das Feld später auch Edge → Cloud, gilt die Null-Clear-Falle: Die Cloud strippt `null`,
   und der Pull hat kein Last-Write-Wins — ein Widerruf am Edge spränge zurück.
6. **`@panary/products` setzt `@panary/allergens` auf demselben Stand voraus.** `product.schema.ts`
   importiert `additiveSchema`, das es erst ab diesem Release gibt. Der Peer-Bereich `^26.4.20`
   (Hauskonvention) erzwingt das nicht — die feste Release-Kopplung und ein vollständiger Pin-Bump
   über alle Manifeste tun es.
7. **Was dieser ADR nicht löst** (Details: [Deklaration am Produkt](../domains/produkt-deklaration.md#grenzen)):
   - Die rechtliche Vollständigkeit des Katalogs belegt kein Test.
   - Für Allergene gibt es nur Codes, keine deutsche Bezeichnung — weder in core noch in cloud.
     Die Legende in panary/panary-cloud#550 braucht sie.
   - Ob `GLUTEN` und `NUTS` bei loser Ware genügen oder die konkrete Getreideart bzw. Schalenfrucht
     genannt werden muss, ist offen. Eine Verfeinerung wäre additiv, zum Beispiel eigene optionale
     Listen am Feld, und bräche nichts.
