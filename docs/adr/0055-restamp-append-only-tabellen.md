---
type: ADR
title: Restamp folgt in Append-only-Tabellen nur den Eigentümer-Spalten
description: Warum der Pairing- und Repair-Restamp die Append-only-Wächter von order-references kurz in der Transaktion entfernt, nur tenantId/locationId umschreibt und eingefrorene ref-Kopien stehen lässt.
tags: [sync, edge, cloud-connection, orders]
status: stable
decision: accepted
generated: { by: claude-code/opus-5.5, at: 2026-10-13T12:00:00Z }
---

# Restamp folgt in Append-only-Tabellen nur den Eigentümer-Spalten

## Problem

`applyCloudTenantId` stempelt beim Pairing (Mandanten- oder Standortwechsel) und im Repair-Hook alle Tabellen mit `tenantId`-Spalte um. Append-only-Tabellen schützen sich per SQLite-Trigger (`BEFORE UPDATE … RAISE(FAIL)`). `audit-events` steht deshalb in `RESTAMP_SKIP_TABLES`. `order-references` (DSFinV-K `Bon_Referenzen`, seit 2026-09-24) stand dort nicht.

Folgen, am Kunden-Edge am 2026-10-13 gemessen:

* Jeder Restamp auf einem Edge mit Bestellreferenzen scheiterte in der Transaktion (`order-references ist append-only — UPDATE nicht erlaubt`) und rollte vollständig zurück. Betroffen waren auch Restamps mit gleicher LocationId, weil der Code `locationId = X where locationId = X` schrieb (panary/panary-core#681).
* Allgemein betraf es jedes Pairing mit Mandantenwechsel auf einem Edge, der schon Stornos hatte (panary/panary-core#682).

## Entscheidung

1. **Nur schreiben, was sich ändert.** Mandant und Standort werden getrennt betrachtet. Ändert sich keines von beiden, kehrt der Restamp ohne Backup und ohne Transaktion zurück. Ein leerer Ziel-Mandant wird verweigert.
2. **Append-only-Tabellen werden umgestempelt, nicht übersprungen.** Bliebe `order-references` auf dem alten Mandanten, versteckte der Mandantenfilter die Storno-Bezüge nach dem Pairing vor Kasse und Sync.
3. **Nur die Eigentümer-Spalten folgen**: `tenantId` und `locationId`. Eingefrorene Kopien wie `refLocationId` bleiben. Sie halten laut Migration den „Stand zum Zeitpunkt des Bezugs“ fest und sind kein Fremdschlüssel. JSON-Array-Spalten werden in solchen Tabellen nicht angefasst.
4. **Wächter kurz entfernen, wortgleich wieder anlegen**, beides innerhalb derselben Transaktion. Scheitert der Restamp, rollt SQLite auch das DDL zurück, und die Wächter sind unverändert da.
5. **Wächter werden aus `sqlite_master` erkannt** (`BEFORE UPDATE` + `RAISE(`), nicht über eine Liste. Eine künftige Journal-Tabelle ist damit ohne Codeänderung erfasst.
6. `RESTAMP_SKIP_TABLES` bleibt, wie es ist. `audit-events` behält bewusst die historischen IDs.

Verworfen:

* **`order-references` in `RESTAMP_SKIP_TABLES` aufnehmen.** Das ist einfach, macht die Referenzen aber unsichtbar (Punkt 2).
* **Trigger dauerhaft auf „alles außer `tenantId`/`locationId`“ lockern.** Das schwächt den Schutz für jeden Schreibpfad, nicht nur für den Restamp. Die Migration verlangt ausdrücklich, dass, wer aufräumen will, die Trigger bewusst droppt.

## Konsequenzen

* Pairing und Repair laufen auf Edges mit Bestellreferenzen durch. Die Fallmatrix `test/apply-cloud-tenant-id.append-only.test.ts` und der Ende-zu-Ende-Test `test/workers/repair-location-restamp.integration.test.ts` laufen gegen die vollständig migrierte SQLite mit allen echten Triggern.
* Während des Restamps ist die Tabelle innerhalb der Transaktion ungeschützt. Andere Schreiber sind durch die SQLite-Schreibsperre ausgeschlossen.
* Eine neue Tabelle mit eingefrorenen `*LocationId`-Kopien **ohne** Append-only-Trigger würde weiterhin mitgezogen. Bisher gibt es keine (gemessen 2026-10-13: einzige Kopie ist `order-references.refLocationId`).
