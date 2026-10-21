---
type: Guide
title: Beträge anzeigen — ein Formatierer für POS, Bon und Admin
description: Wie Euro-Beträge im Client formatiert werden (`formatEur`, `formatEurCents`, `eur`-Pipe), warum Angulars `currency`-Pipe verboten ist und welche Ausgaben bewusst anders aussehen.
tags: [ui, formatierung, pos-client, admin-client, receipts]
status: stable
generated: { by: claude-code/sonnet-5.5, at: 2026-10-21T00:00:00.000Z }
---

# Beträge anzeigen

Alle Euro-Beträge erscheinen als de-DE-Text: `16,50 €` (geschütztes Leerzeichen vor dem Zeichen,
Tausenderpunkt, Minus vor der Zahl). Einen Formatierer gibt es genau einmal, in
`libs/shared/util-helpers/src/lib/format-eur.ts`.

| Wo | Was verwenden |
|---|---|
| Angular-Template | `{{ betrag \| eur }}` (`EurPipe` aus `@panary/shared/ui-common`, pure) |
| TypeScript, Euro | `formatEur(16.5)` |
| TypeScript, Cent | `formatEurCents(1650)` |

`null`, `undefined` und nicht-endliche Werte ergeben einen leeren Text; `-0` und Beträge unter einem
halben Cent erscheinen als `0,00 €`, nie als `-0,00 €`. Der `Intl.NumberFormat` entsteht einmal pro
Modul-Ladung, nicht pro Aufruf.

## Verboten

- **`| currency: 'EUR'`**: Die Pipe folgt `LOCALE_ID`, und der steht im Client auf en-US — das ergab
  `€16.50` neben `4.20 €` und `14,90 €`.
- `toFixed(2)` mit angehängtem `€`/`EUR`, `.replace('.', ',')`, eigene `new Intl.NumberFormat(...)`.

## Ausnahmen (Absicht)

- **ESC/POS-Thermobon** (`apps/api-edge/src/print-server/*renderer.ts`): bleibt `16,50 EUR`. Das Eurozeichen
  fehlt in manchen Codepages (CP437/CP850, Transliteration in `escpos-transliteration.ts`), und der
  Betrag steht in einer festen Spaltenbreite.
- **`receipts/domain` (`buildReceiptHtml`)** hat einen eigenen, währungsgenerischen de-DE-Formatter, weil
  das Paket dependency-frei bleiben muss; Fremdwährungen erscheinen dort ebenfalls de-DE (`16,50 $`).
- **Kompakte Stückelungs-Labels** im Kassenladen-Dialog (`500 €`, `1 ct`) sind Beschriftungen, keine Beträge.
