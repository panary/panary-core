---
type: ADR
title: Fluide POS-UI-Skalierung — Root-rem-Skalierung hinter Klassen-Gate statt komponentenlokaler Lösungen
description: Die POS-UI skaliert über eine viewport-abhängige Root-Fontsize (clamp × Terminal-Density) hinter der Klasse pnry-fluid-scale; px→rem-Äquivalenz macht den Flag-off-Pfad pixelidentisch ohne doppelten Stylesheet-Pfad.
tags: [pos-client, devices, ui]
status: stable
decision: accepted
generated: { by: claude-code/fable-5, at: 2026-07-27T13:20:00Z }
---

# ADR 0013 — Fluide POS-UI-Skalierung (PNRY-FEAT-POS-UI-SCALE-001)

## Problem

Der POS-Client skalierte auf großen/hochauflösenden Monitoren (WQHD, große Full-HD-Touchmonitore)
nicht mit dem Viewport: Artikel-Tiles, Tabs, Ziffernblock und Schriften hatten fixe Pixelgrößen,
auf WQHD entstand massiver Leerraum. Es gab keinen Mechanismus, die UI-Dichte pro Terminal an
Monitorgröße und Sichtabstand anzupassen. Gleichzeitig musste der Bestand regressionssicher
bleiben (Rollout zunächst nur auf Test-Terminals).

## Entscheidung

1. **Root-rem-Skalierung statt komponentenlokaler Lösungen:** Alle größenrelevanten Werte sind
   rem-basiert; die Skalierung passiert zentral über die Root-Fontsize
   `calc(clamp(var(--pnry-root-fs-min), var(--pnry-root-fs-fluid), var(--pnry-root-fs-max)) * var(--pnry-density))`.
   Die clamp()-Parameter (Start: `14px`, `0.6vw + 9px`, `22px`) sind Custom Properties — anpassbar
   ohne Codeänderung. Komponentenlokale Skalierungs-Hacks (eigene `zoom`-/`scale`-Mechaniken) sind
   verboten.
2. **Klassen-Gate statt doppeltem Stylesheet-Pfad:** Die fluide Root-Regel und alle
   Verhaltensänderungen (Tailwind-Variant `fluid:`, Touch-Floors) greifen ausschließlich unter
   `html.pnry-fluid-scale`. Da alle px→rem-Konvertierungen exakt ÷16 erfolgten, ist der
   Flag-off-Zustand bei Browser-Default 16px **pixelidentisch** zum Altbestand — es gibt keinen
   zweiten „Legacy-Stylesheet-Pfad", der divergieren könnte.
3. **Terminal-Flag lokal:** panary-core besitzt keine Feature-Flag-Infrastruktur; das Flag
   `pos-fluid-ui-scaling-v1` lebt als localStorage-Opt-in pro Terminal
   (`pnry_feature.pos-fluid-ui-scaling-v1`, Default off) mit Toggle in den POS-Einstellungen.
4. **Terminal-Density am Device-Record:** `device.uiScale = { density, factors? }` (TypeBox,
   optional; Stufen compact 0.9 / default 1.0 / comfortable 1.15 / large 1.3, Faktoren pro Gerät
   überschreibbar — Konfiguration statt Hardcoding). Quelle der Wahrheit fürs Terminal ist
   localStorage (`pnry_ui_scale`, offline-first); der Device-Record wird best-effort gespiegelt.
5. **Self-Patch-Absicherung:** `DEVICE_POS` erhielt `devices:[READ, UPDATE]`, abgesichert durch
   `device-self-patch-policy` (nur eigener Datensatz, Feld-Whitelist ausschließlich `uiScale`) —
   Muster analog der User-Self-Patch-Policy.
6. **Harter Touch-Floor:** `min-height: max(3.5rem, 48px)` (`.pnry-touch`) bzw. `max(4rem, 48px)`
   (`.pnry-touch-primary`) — das px-Floor in `max()` ist bewusst: bei compact (0,9) × minimaler
   Root-Fontsize (14px) wären reine 3.5rem nur 44,1px.

## Konsequenzen

* px-Werte für Font-Size/Padding/Margin/Größen interaktiver Elemente sind im POS-Scope verboten;
  `pnpm audit:pos-px` (tools/pos-px-audit.mjs) ist das Gate (Whitelist: Borders, Hairlines,
  Schatten, `max(…, 48px)`, `px-ok`-Marker).
* Neue POS-UI muss rem-basiert gebaut werden; flag-abhängige Layout-Änderungen über die
  Tailwind-Variant `fluid:`.
* JS-Layout-Konstanten, die gegen gerenderte Breiten rechnen, müssen mit der aktuellen
  Root-Fontsize skalieren (Muster `remFactor` in `calculateVisibleProductGroups`).
* Cloud-seitig (cloud-direct-Tier) schlägt der uiScale-Patch bis zum Pin-Bump von
  `@panary/devices` + `@panary/users` in panary-cloud fehl (403/400) — der Client fängt das ab;
  zusätzlich braucht api-cloud dann ein Pendant des `restrictDeviceSelfPatch`-Hooks.
* Rollout: Opt-in auf Test-Terminals (Sunmi, WQHD), nach Validierung Default-on; danach kann das
  Klassen-Gate entfernt werden (Klasse dauerhaft setzen, Flag-Toggle ausbauen).

Details zur Mechanik: [Architektur — Fluide POS-UI-Skalierung](../architecture/pos-fluid-ui-scaling.md).
DPI-Analyse (Tauri/Windows): `_planning/pnry-feat-pos-ui-scale-001-dpi-findings.md`.
