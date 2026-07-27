---
type: Architecture
title: Fluide POS-UI-Skalierung & Terminal-Density — Mechanik-Referenz
description: Referenz der Skalierungs-Mechanik im POS-Client — CSS-Tokens, Klassen-Gate, Tailwind-Variant fluid, Terminal-Density via device.uiScale, UiScaleService-Persistenz und px-Audit.
tags: [pos-client, devices, ui]
status: stable
generated: { by: claude-code/fable-5, at: 2026-07-27T13:20:00Z }
---

# Fluide POS-UI-Skalierung & Terminal-Density (PNRY-FEAT-POS-UI-SCALE-001)

Entscheidung und Begründung: [ADR 0013](../adr/0013-pos-fluide-ui-skalierung.md). Diese Seite ist
die Mechanik-Referenz für Weiterentwicklung und Betrieb.

## CSS-Fundament (`apps/pos-client/src/styles.scss`)

| Token / Regel | Wert / Zweck |
|---|---|
| `--pnry-density` | Terminal-Density-Faktor (Default 1); setzt der `UiScaleService` per Inline-Style auf `<html>` |
| `--pnry-root-fs-min` / `--pnry-root-fs-fluid` / `--pnry-root-fs-max` | clamp()-Parameter der Root-Fontsize (Start: `14px` / `0.6vw + 9px` / `22px`) — anpassbar ohne Codeänderung |
| `--pnry-tile-min` | Mindestbreite Artikel-Tile (`6.25rem` = 100px Bestand); Raster: `repeat(auto-fill, minmax(var(--pnry-tile-min, 6.25rem), 1fr))` |
| `html.pnry-fluid-scale { font-size: … }` | Aktivierungs-Gate: Root-Fontsize = clamp × Density — ausschließlich mit dieser Klasse |
| `@custom-variant fluid` | Tailwind-Variant: `fluid:`-Utilities greifen nur unter `html.pnry-fluid-scale` |
| `.pnry-touch` / `.pnry-touch-primary` | Touch-Floors `max(3.5rem, 48px)` / `max(4rem, 48px)` — nur im Fluid-Modus wirksam, garantieren ≥ 48px in jeder Density/Viewport-Kombination |

**Invariante:** Flag off (keine Klasse) ⇒ Root 16px ⇒ pixelidentisch zum Altbestand, da alle
px→rem-Konvertierungen exakt ÷16 erfolgten. Ungegatete Layout-Verhaltensänderungen sind verboten.

## Terminal-Density

* **Schema:** `device.uiScale = { density: 'compact'|'default'|'comfortable'|'large', factors?: Partial<Record<…, number(0.5–2)>> }`
  in `@panary/devices/domain` (`UiDensity`, `DEFAULT_UI_DENSITY_FACTORS`: 0.9 / 1.0 / 1.15 / 1.3).
  SQLite-Spalte `uiScale` (JSON-Text, Migration `20260727130403_devices_add_ui_scale`).
* **RBAC:** `DEVICE_POS` hat `devices:[READ, UPDATE]` — abgesichert durch
  `device-self-patch-policy` (Domain) + `restrictDeviceSelfPatch`-Hook (api-edge, `before.patch`
  vor validate/resolve): nur der eigene Datensatz (deviceId-Vergleich via Auth-Payload), nur das
  Feld `uiScale`. Rollen mit `devices:MANAGE` passieren frei.
* **`UiScaleService`** (`libs/shared/data-access-theme`): liest beim Boot synchron localStorage
  (`pnry_feature.pos-fluid-ui-scaling-v1` = 'on'/'off', `pnry_ui_scale` = JSON) und wendet nur
  zwei DOM-Operationen an (Klasse + `--pnry-density`) — Live-Vorschau ohne Re-Render.
  Persistenz offline-first: localStorage ist Quelle der Wahrheit; der Device-Record wird
  best-effort gespiegelt (Boot-Reconcile: lokal gewinnt, ohne lokalen Wert wird der Server-Wert
  übernommen). Boot-Wiring: `provideEnvironmentInitializer` nur in `apps/pos-client`.
* **Settings-UI:** POS-Einstellungen → Darstellung: Toggle „Fluide UI-Skalierung (Beta)" +
  Density-Auswahl (wirkt sofort, gilt pro Terminal).

## px-Audit (Akzeptanz-Gate)

`pnpm audit:pos-px` (tools/pos-px-audit.mjs) scannt `apps/pos-client`, `libs/apps/pos-client` und
alle `libs/domains/*/feature-pos*` auf größenrelevante px-Werte (Tailwind-Arbitrary + CSS).
Whitelist: Borders/Hairlines, Schatten, `letter-spacing`, `stroke-width`, exakt `1px`,
`max(…, 48px)`, `@media`, Marker `/* px-ok */` bzw. `<!-- px-ok -->`. Exit 1 bei Findings.
Bekannte Lücke: Inline-`style`-Attribute und px-Strings in .ts (z. B. MatDialog-`width`) erfasst
das Script nicht — bei Reviews manuell prüfen.

## Betrieb & Rollout

1. Opt-in pro Terminal über den Settings-Toggle (Flag-Default off).
2. Sichttest der clamp()-Parameter auf WQHD + Sunmi (Gate: Michael) — Feintuning ausschließlich
   über die `--pnry-root-fs-*`-Tokens.
3. DPI-Verifikation auf Windows-Terminals (100/125/150 %) über die Boot-Logzeile
   `[pos-boot] display-metrics` — Analyse und Auskoppel-Kriterien:
   `_planning/pnry-feat-pos-ui-scale-001-dpi-findings.md`.
4. Nach Validierungsphase: Default-on, danach Gate-Rückbau (Klasse dauerhaft, Toggle entfernen).
5. Cloud-direct-Tier: uiScale-Patch erfordert in panary-cloud Pin-Bump `@panary/devices` +
   `@panary/users` und ein Cloud-Pendant des Self-Patch-Hooks (bis dahin 403/400, vom Client
   abgefangen; Edge→Cloud-Sync betrifft devices nicht).
