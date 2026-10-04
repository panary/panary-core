---
type: ADR
title: 'Journal-Ereignisse nach der Annahme: Bei Geräte-Sessions schreibt der POS, nicht der Patch-Hook'
description: 'ADR zum Bediener im Journal (order-interactions) für Änderungen nach der Bestellannahme: Am POS ist params.user der virtuelle Geräte-User device:<uuid>, der after.patch-Hook kann den Menschen nicht kennen. Der Storno-Dialog schreibt den order-cancel deshalb selbst, userId ist der per verifyPin bestätigte Manager. Kein Bediener-Feld im Patch, weil orderPatchSchema geschlossen ist und POS und Edge getrennt ausgerollt werden.'
tags: [orders, order-interactions, journal, pos, edge, sync]
status: stable
decision: accepted
implementation: 'Umgesetzt 2026-10-04 (#591): cancel-order-dialog.component.ts schreibt order-cancel, record-order-patch-interaction.ts überspringt Geräte-Sessions. Der Split (#590) löst dasselbe Problem über performedBy im Request der Custom Method.'
generated: { by: claude-code/opus-5.5, at: 2026-10-04T16:50:00Z }
---

# Journal-Ereignisse nach der Annahme: Bei Geräte-Sessions schreibt der POS

## Problem

[ADR 0048](0048-vorgangs-referenzen-append-only.md) §7 gab dem Journal einen
`after.patch`-Pfad (`recordOrderPatchInteraction`), mit `params.user._id` als Bediener. Am
POS ist `params.user` aber der virtuelle Geräte-User aus `allowApiKey`: `device:<uuid>`,
kein Mensch und kein UUID. Jeder serverseitige `order-cancel` vom POS scheiterte damit an
`format: uuid`. Weil das Journal nicht blockiert, stand das nur im Log
(`order.patch_interaction_failed`). Gefunden wurde es über denselben Fehler im Split
([#590](https://github.com/panary/panary-core/issues/590)).

Den Menschen an der Kasse kennt nur der POS (PIN-Login, beim Storno zusätzlich der per
`verifyPin` bestätigte Manager). Er muss also vom POS kommen. Offen war der Weg.

## Entscheidung

**Bei Geräte-Sessions schreibt der POS das Journal-Ereignis selbst**, per
`order-interactions.create` nach dem erfolgreichen Patch. Der Hook überspringt
`device:*`-User und deckt nur noch JWT-Sessions ab.

**Beim Storno ist `userId` der autorisierende Manager.** Seine ID hat der Server per
`verifyPin` bestätigt. Storniert ein Manager selbst (ohne PIN-Schritt), ist er es ohnehin.
Der Name steht wie bisher in `cancellation.canceledBy`.

Verworfen:

| Weg | Warum nicht |
|---|---|
| Neues Feld `cancellation.canceledByUserId` | `cancellation` reist im Sync zur Cloud. Deren Schema ist geschlossen, das Feld wäre dort TERMINAL abgelehnt, bis die Cloud den Pin hochzieht und vorher released. Zusätzlich lehnt ein Edge, der älter ist als der POS, jeden Storno mit dem Feld ab. |
| Hilfsfeld im Patch, das ein Hook vor `validateData` herausnimmt (Muster `extractOrderInteractions`) | Nichts würde persistiert, aber ein älterer Edge kennt den Hook nicht: `orderPatchSchema` (`additionalProperties: false`) lehnte **jeden** Storno eines neueren POS mit 400 ab. POS (`pos-v*`) und Edge (`v*`) haben getrennte Release-Kanäle. |
| Bediener je Socket-Verbindung am Edge merken | Trägt für alle Aufrufe, wäre aber eine neue Sitzungs-Schicht mit eigener Sicherheitsfrage (wer darf sie setzen, was passiert beim Bedienerwechsel). Zu groß für einen Bugfix. |

Der gewählte Weg ist in jeder Versionsmischung harmlos: `order-interactions.create` vom
Gerät funktioniert in jedem Edge-Stand (die Abbruch-Einträge des Bestelldialogs laufen
schon so). Ein alter POS an einem neuen Edge schreibt kein Ereignis, statt still zu
scheitern.

## Konsequenzen

- Zwei Aufrufe statt einem, nicht atomar. Fällt das Journal aus, gilt der Storno trotzdem.
  Das entspricht der bestehenden Regel „nicht blockierend" aus ADR 0048 §7.
- Die `userId` nennt der Client. Das ist beim Storno vertretbar, weil sie aus der
  Server-Antwort von `verifyPin` stammt, und es entspricht `performedBy` der
  Bar-Transaktion. Der Edge prüft die ID beim Journal-Create nicht gegen den Mandanten.
- **Für künftige Ereignisse nach der Annahme** (Nachbuchung, Umbuchung) gilt dasselbe:
  Ein `after.patch`-Hook erreicht bei Geräte-Sessions keinen Menschen. Entweder schreibt
  der POS das Ereignis, oder die Operation ist eine Custom Method mit eigenem Request wie
  `orders.split` (#590), dort trägt `performedBy` den Bediener.
- Der Typ `order-cancel` hat damit zwei Schreiber im POS: den Storno-Dialog und den
  Abbruch des Bestelldialogs (`order-dialog.component.ts` `dialogClose()`). Sie
  unterscheiden sich nur an den Feldern, nicht am Typ. Das war vorher schon so und ist hier
  nicht gelöst.
