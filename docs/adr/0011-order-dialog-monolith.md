---
type: ADR
title: Order-Dialog — bewusster Komponenten-Monolith, Logik-Extraktion statt Sub-Komponenten-Zerteilung
description: Der POS-Order-Dialog bleibt bewusst eine große Einzelkomponente; statt Sub-Komponenten-Zerteilung wird Logik in testbare plain classes und pure functions extrahiert.
tags: [orders, pos, ui]
status: stable
decision: accepted
generated: { by: claude-code/historic, at: 2026-07-07T00:00:00Z }
---

# Order-Dialog — bewusster Komponenten-Monolith, Logik-Extraktion statt Sub-Komponenten-Zerteilung

> **Für kommende Qualitäts-Reviews:** `order-dialog.component.ts` (feature-pos-order-dialog) ist
> **bewusst** eine große Einzelkomponente. Bitte nicht erneut als „God-Component, in
> Sub-Komponenten aufteilen" flaggen — die Abwägung steht unten. Erlaubt und erwünscht ist
> weitere **Logik-Extraktion** in testbare plain classes / pure functions innerhalb derselben Lib
> (Muster siehe §3).

## Problem

Der POS-Bestelldialog (`libs/domains/orders/feature-pos-order-dialog/`) war mit ~2.570 Zeilen und
15 injizierten Services der größte Einzel-Baustein des POS (Qualitäts-Review 2026-07-03, Stufe 3
Punkt 4). Der User erinnerte eine frühere bewusste Entscheidung, den Dialog groß zu lassen —
die Begründung war nicht mehr auffindbar. Recherche-Ergebnis (2026-07-05, git-Historie,
Doku beider Repos, `.claude/rules`):

1. **„Dialoge sind ihrer Natur nach monolithisch"** — dokumentierte Abbruch-Entscheidung des
   God-Component-Zerlegungsprogramms in `panary-cloud/docs/guides/tech-debt-backlog.md`
   (2026-05-18): Nach 3 von 6 Zerlegungen zeigte `supplier-details` den Kipppunkt (−2 % Code bei
   4 Commits); Dialoge wurden explizit als „eine Sache, fokussiert" eingestuft — Sub-Komponenten
   wären künstliche Trennungen.
2. **Phase-5-Sharing-Plan** — `panary-cloud/docs/architecture/shopify-layout-migration-plan.md` sieht
   vor (deferred), den Order-Dialog als **Ganzes** in eine zwischen POS und Cloud teilbare Lib zu
   überführen. Ein in sich geschlossener Dialog bleibt dafür leichter übernehmbar.
3. Die Komponente hatte **keine Specs** — jede strukturelle Zerteilung (Template-Splits, neue
   Input/Output-Verträge) wäre ohne Verhaltensnetz das höchste Regressionsrisiko gewesen.

## Entscheidung

**Keine Zerteilung in Sub-Komponenten.** Stattdessen Logik-Extraktion innerhalb der Lib
(2026-07-07, Branch `feature/god-components-logic-extraction`):

| Schritt | Extrakt | Form | Netz |
|---|---|---|---|
| 1 | `setMenuSideDish/Sauce/DrinkButtons`-Triplikation | generischer `setMenuSlotButtons()`-Schritt + `rememberSelectedParentId()`/`lastParentProduct()` | Build + minimaler Diff |
| 2 | Menü-/Bundle-Flow (OptionGroup-Sequenz, HIGHEST-Preisregel, FIXED_PROPORTIONAL-Komponenten) | `bundle-flow.ts` — plain class `BundleFlow`, Katalog-Lookups als injizierte Funktionen (kein Angular-DI) | 18 Charakterisierungs-Specs |
| 3 | Board-Blätter-Navigation (Kombinationen → Artikel → keine Auswahl) | `board-selection.ts` — pure Übergangsfunktionen | 14 Charakterisierungs-Specs |

Der Komponenten-Rest bleibt bewusst zusammen: UI-Orchestrierung (Button-Arrays, InfoBox,
Blocking), Checkout (`placeOrder`), Numpad, Kunden/Personalessen — eng über gemeinsamen
Auswahl-Zustand verflochten, genau der Fall, für den die Dialog-Monolith-Entscheidung gilt.

## Konsequenzen

- Die Lib hat jetzt ein `test`-Target (vitest); extrahierte Logik ist ohne TestBed testbar.
- Weitere Extraktionen folgen demselben Muster: **Logik raus (plain class / pure function,
  Specs dazu), Zustand und Template bleiben in der Komponente.** Kandidaten: Numpad-/Multiplier-
  Logik, Rabatt-Snapshot-Builder (`#toDiscount`/`#toAppliedDiscount`).
- Der Phase-5-Sharing-Plan bleibt unberührt — alles lebt weiterhin in
  `@panary/orders/feature-pos-order-dialog`.
- Gleiches Vorgehen im Schwester-Fall `storefront-editor.component.ts` (panary-cloud):
  dort dokumentiert in `panary-cloud/docs/guides/tech-debt-backlog.md`.
