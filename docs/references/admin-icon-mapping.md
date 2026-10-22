---
type: Reference
title: Admin-Icons — Mapping Material Symbols → Phosphor Regular
description: Tabelle aller im Core-Admin ersetzten Material-Symbols-Namen mit dem gewählten Phosphor-Regular-Icon, Abgrenzung zur POS-Registry und Anleitung, ein Icon zu ergänzen.
tags: [admin-client, icons, design-system]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-22T00:00:00.000Z }
sources:
  - id: generator
    resource: ../../tools/phosphor/build-icons.mjs
    title: Generator dieser Tabelle
  - id: pos-mapping
    resource: ./pos-icon-mapping.md
    title: POS-Icons (Phosphor Bold)
---

# Admin-Icons: Material Symbols → Phosphor Regular

Der Core-Admin (`apps/admin-client`) zeigt Icons über `<app-icon name="…">`
(`apps/admin-client/src/app/shared/icon/icon.ts`). Die Komponente zeichnet ein Inline-SVG aus der
App-eigenen Registry `icons.generated.ts` daneben, die nur die benutzten Phosphor-Regular-Pfade enthält
(35 Icons, kein Font, kein CDN). Größe folgt `font-size` (`1em`), Farbe folgt `currentColor`.
Die Material-Symbols-Schrift ist aus dem Admin entfernt.

## Warum eine eigene Registry statt `<lib-icon>`

`<lib-icon>` (`@panary/shared/ui-common`) zeichnet Phosphor **Bold** für den POS. Eine gemeinsame
Registry mit beiden Gewichten legte jeden Admin-Pfad in das POS-Initial-Bundle, das am Budget steht
(core#805). Die Admin-Registry liegt deshalb in der App selbst und erreicht den POS nie. Die Zuordnung
Material → Phosphor übernimmt der Admin, wo der POS sie schon getroffen hat (`FROM_POS` in
`tools/phosphor/admin-icon-mapping.mjs`) — beide Oberflächen sprechen dieselbe Bildsprache, nur das
Gewicht unterscheidet sich.

Geteilte Komponenten aus Libs, die `<lib-icon>` nutzen (Cloud-Status-Banner aus
`@panary/shared/ui-cloud-status`), zeigen auch im Admin Bold.

## Neues Icon ergänzen

1. Material-Name in `FROM_POS` aufnehmen, wenn der POS ihn schon abbildet; sonst Zeile in `ADMIN_ONLY`
   (`tools/phosphor/admin-icon-mapping.mjs`).
2. `pnpm icons:build` — erzeugt die Registry und diese Tabelle neu.
3. `name="…"` ist über `AdminIconName` typgeprüft: ein Tippfehler bricht den Build, es gibt kein leeres Kästchen.

## Tabelle

| Material Symbols | Phosphor Regular | Anmerkung |
|---|---|---|
| `category` | `stack` | Warengruppen |
| `check` | `check` |  |
| `chevron_left` | `caret-left` |  |
| `chevron_right` | `caret-right` |  |
| `cloud` | `cloud` |  |
| `cloud_done` | `cloud-check` |  |
| `cloud_download` | `cloud-arrow-down` | Hinweis „Daten aus der Cloud" |
| `cloud_off` | `cloud-slash` |  |
| `cloud_sync` | `cloud-arrow-up` |  |
| `content_copy` | `copy` |  |
| `dashboard` | `squares-four` |  |
| `description` | `file-text` | Protokolle |
| `devices` | `devices` |  |
| `dns` | `hard-drives` |  |
| `emergency_home` | `warning-octagon` | Notfall-Hinweis des Cloud-Banners |
| `error` | `warning-circle` |  |
| `event` | `calendar-dots` |  |
| `inventory_2` | `package` | Produkte |
| `key` | `key` |  |
| `lan` | `network` |  |
| `logout` | `sign-out` |  |
| `menu` | `list` |  |
| `more_horiz` | `dots-three` |  |
| `people` | `users` |  |
| `person` | `user` |  |
| `print` | `printer` |  |
| `receipt_long` | `receipt` |  |
| `restaurant` | `fork-knife` |  |
| `schedule` | `clock` |  |
| `store` | `storefront` |  |
| `sync_problem` | `cloud-warning` | Sync-Status und Sync-Probleme |
| `table_restaurant` | `table` |  |
| `unfold_more` | `caret-up-down` | Sprachauswahl |
| `vibration` | `vibrate` | Pager |
| `warning` | `warning` |  |
