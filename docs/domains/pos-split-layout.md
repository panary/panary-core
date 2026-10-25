---
type: Domain Concept
title: POS-Split-Layout — Liste links, Detail rechts
description: Wie Vorbestellungen und Historie im Breitformat aufgebaut sind — Komponente lib-pos-split, Detailbreite clamp(400px, 32%, 600px), Kartenraster je Bildschirmbreite, Historien-Liste bis 820 px, Gruppierung nach Abholtag, Leerzustände; Sunmi-Maß offen.
tags: [pos-client, ui]
status: draft
generated: { by: claude-code/opus-5.5, at: 2026-10-25T15:00:00Z }
---

Designstudie POS-Screens v2 (E9), Anker panary/panary-core#819, Umsetzung panary/panary-core#975.

| Baustein | Ort |
|---|---|
| `PosSplitComponent` (`lib-pos-split`) | `libs/shared/ui-common/src/lib/pos-split/` — nicht in der Shell, weil Feature-Libs die Shell nicht importieren dürfen (die Shell lädt sie) |
| Vorbestellungen | `libs/domains/pre-orders/feature-pos-list` |
| Historie | `libs/domains/orders/feature-pos-history` |

- **Detail** `clamp(400px, 32%, 600px)`, Liste nimmt den Rest. Unter 1024 px zeigt die Komponente entweder Liste oder Detail (`detailOpen`).
- **Vorbestellungen:** Karten im Raster `repeat(auto-fill, minmax(20rem, 1fr))` — 2 Spalten bei 1366, 3 bei 1920; gruppiert nach Abholtag (Heute, Morgen, Datum).
- **Historie:** Liste bis 820 px (`listMaxWidth`), kein Lila mehr (Akzent-Tokens).
- **Leerzustände** nennen den Zeitraum; Historie „Heute" bietet „Gestern ansehen", Vorbestellungen „Neue Vorbestellung anlegen".
- **Seitenköpfe:** beide Seiten nutzen `lib-page-header` (core#972), ohne Zurück-Pfeil; Suche im Kopf, Zeitraum-Tasten bzw. „Neue Vorbestellung" als Aktionen.
- **Spiegelung mit der Bedienhand** (panary/panary-core#976): Die Shell setzt `data-rail-side` (`left`/`right`) auf `#app-frame`. Das Detail mit den Aktionen sitzt an der Rail, die Auswahl gegenüber; sitzt die Rail links, kehren `lib-pos-split` und die Einstellungs-Navigation per `:host-context` bzw. `[[data-rail-side=left]_&]:flex-row-reverse` die Reihenfolge um. Text bleibt linksbündig. `lib-page-header` spiegelt nicht: Titel links, Aktionen ihm gegenüber am rechten Rand (panary/panary-core#1022). Features lesen nur das Attribut und importieren die Shell nicht.

**Offen:** das echte Sunmi-Maß (`innerWidth × innerHeight` am Gerät) liegt nicht vor; umgesetzt sind 1366 und 1920.
