---
title: PosButton-View-Model — POS-Dialog mutiert keine ProductService-Cache-Objekte mehr
date: 2026-07-03
category: Architektur
domains: [orders, products]
status: implementiert
---

# PosButton-View-Model — POS-Dialog mutiert keine ProductService-Cache-Objekte mehr

## Problem

`ProductService` (`@panary/products/data-access`) hält alle aktiven Produkte in einem
app-weit geteilten Signal-Store. Die Finder (`findProductById`, `findProductByExternalId`,
`findProductByIndex`, `getProductsByGroupId`, `extras()`) geben **Referenzen** auf diese
Cache-Objekte zurück — keine Kopien.

Der POS-Bestelldialog (`libs/domains/orders/feature-pos-order-dialog`) hängte UI-Zustand
direkt an diese Referenzen: `(product as any).callback = …`, `pressed`, `isMenuSideDish` etc.
Folgen:

- **Shared-State-Mutation:** UI-Callbacks/Flags landeten auf app-weit geteilten Cache-Objekten
  (stale Closures auf geschlossene Dialog-Instanzen, Zustand „blutet" zwischen Dialog-Öffnungen).
- **Schema-Bypass-Risiko:** Die Zusatzfelder existieren nicht im Produkt-Schema
  (`additionalProperties: false`) — würde ein Konsument ein so verunreinigtes Cache-Objekt
  zurückschreiben, lehnte die Validierung den Record ab.
- Inkonsistenz: manche Stellen kopierten per `JSON.parse(JSON.stringify(…))`, andere nicht.

## Entscheidung

Neues typisiertes View-Model in der Dialog-Lib (`src/lib/pos-button.model.ts`):

- `PosButtonUiState` — alle UI-/Legacy-Felder getypt (`callback`, `pressed`, `isMenu*`,
  `isFunctionButton`, `backgroundColor`, …).
- `PosProductButton = ProductSchema & PosButtonUiState` — Produkt-Taste als **Kopie**.
- `PosButton = Partial<ProductSchema> & PosButtonUiState & Pick<ProductSchema, '_id' | 'name'>`
  — Trägertyp der Button-Arrays (deckt auch synthetische Funktionstasten: Skip/Tisch/Pager/Kombi).
- `toPosButton(product, ui?)` — Shallow-Copy-Fabrik. Shallow reicht, weil der Dialog
  ausschließlich Top-Level-Felder setzt (`callback`, `pressed`, `price`, Flags).

Alle Stellen, die Buttons aus Store-Produkten bauen, mappen jetzt auf `toPosButton`-Kopien;
die bisherigen JSON-Deep-Copy-Stellen sind auf dasselbe Mapping umgezogen.
`_productButtons`/`_functionButtons` sind `PosButton[]` statt `any[]`; die dabei berührten
`as any`-Casts entfielen (~90 → 46, Rest sind Legacy-Feld-Reads auf Cache-Objekten).

## Konsequenzen / Regel

> **Rückgaben der ProductService-Finder (und anderer Store-Services) sind geteilte
> Referenzen — niemals mutieren.** UI-Zustand gehört auf eine VM-Kopie
> (hier: `toPosButton`), nie ans Cache-Objekt.

- Verhalten des Dialogs unverändert (Callbacks lesen Produktfelder nur; Kopien tragen
  identische Anzeige-Felder). Abgesichert über `nx build pos-client` (strictTemplates) + Lint.
- Kein anderer Code liest `callback`/`pressed`/`isMenu*` aus dem Store (Grep-verifiziert) —
  das Entfernen der Cache-Mutation ist daher regressionsfrei.
- Verbleibende `as any`-Casts (Legacy-Felder wie `sauces`, `excludedButtons` auf
  Cache-Produkten) sind read-only und Teil der God-Component-Zerlegung (Review-Stufe 3).
