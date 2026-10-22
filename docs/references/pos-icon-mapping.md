---
type: Reference
title: POS-Icons — Mapping Material Symbols → Phosphor Bold
description: Tabelle aller im POS ersetzten Material-Symbols-Namen mit dem gewählten Phosphor-Bold-Icon, den Entscheidungen für fehlende Entsprechungen und der Anleitung, ein Icon zu ergänzen.
tags: [pos-client, icons, design-system]
status: stable
generated: { by: claude-code/sonnet-5.5, at: 2026-10-22T00:00:00.000Z }
sources:
  - id: generator
    resource: ../../tools/phosphor/build-icons.mjs
    title: Generator dieser Tabelle
---

# POS-Icons: Material Symbols → Phosphor Bold

Der POS zeigt Icons über `<lib-icon name="…">` (`@panary/shared/ui-common`). Die Komponente zeichnet ein
Inline-SVG aus der Registry in `@panary/shared/util-helpers` (`iconPath()`), die nur die benutzten Phosphor-Bold-Pfade enthält (103 Icons, kein Font,
kein CDN). Größe folgt `font-size` (`1em`), Farbe folgt `currentColor` — die bisherigen Klassen
(`text-[1rem]`, `text-amber-600`, `animate-spin`) gelten unverändert am `<lib-icon>`.

## Neues Icon ergänzen

1. Zeile in `tools/phosphor/pos-icon-mapping.mjs` (Material-Name bleibt Schlüssel, damit die Tabelle lückenlos bleibt)
   oder, für ein neues Icon ohne Material-Vorbild, mit dem Phosphor-Namen als Schlüssel.
2. `pnpm icons:build` — erzeugt `icons.generated.ts` und diese Tabelle neu.
3. Gebaute Libs (z. B. `orders-data-access`) können `ui-common` nicht importieren und zeichnen das SVG selbst:
   `<svg viewBox="0 0 256 256" class="size-[1.25em] fill-current" aria-hidden="true"><path [attr.d]="iconPath('x')" /></svg>`.
4. `name="…"` ist über `IconName` typgeprüft: ein Tippfehler bricht den Build, es gibt kein leeres Kästchen.

## Fehlende oder gedrehte Entsprechungen (Entscheidung core#824)

- `merge_type` (Kombi, in Material gedreht) → `arrows-merge`, ohne Drehung.
- `remove_done` → `list-dashes`: neutrale Liste, die Bedeutung trägt der Text der Taste.
- `print_disabled`, `group_off`, `domain_disabled`, `search_off`: kein „durchgestrichen"-Icon in Phosphor Bold;
  der Zustand steht im Text bzw. in der Farbe.

## Tabelle

| Material Symbols | Phosphor Bold | Anmerkung |
|---|---|---|
| `add` | `plus` |  |
| `add_circle` | `plus-circle` |  |
| `add_shopping_cart` | `shopping-cart-simple` |  |
| `apartment` | `buildings` |  |
| `apps` | `squares-four` |  |
| `arrow_back` | `arrow-left` |  |
| `arrow_forward` | `arrow-right` |  |
| `aspect_ratio` | `frame-corners` |  |
| `backspace` | `backspace` |  |
| `badge` | `identification-badge` |  |
| `block` | `prohibit` |  |
| `bolt` | `lightning` |  |
| `brightness_auto` | `circle-half` | Phosphor kennt kein „Auto"; Halbkreis steht für „System" |
| `bug_report` | `bug` |  |
| `build` | `wrench` |  |
| `business` | `buildings` |  |
| `call` | `phone` |  |
| `call_split` | `arrows-split` |  |
| `cancel` | `x-circle` |  |
| `check` | `check` |  |
| `check_circle` | `check-circle` |  |
| `check_circle_outline` | `check-circle` | Outline/Fill gibt es in Bold nicht getrennt |
| `chevron_left` | `caret-left` |  |
| `chevron_right` | `caret-right` |  |
| `close` | `x` |  |
| `cloud` | `cloud` |  |
| `cloud_off` | `cloud-slash` |  |
| `cloud_sync` | `cloud-arrow-up` |  |
| `coffee` | `coffee` |  |
| `confirmation_number` | `ticket` |  |
| `content_copy` | `copy` |  |
| `dark_mode` | `moon` |  |
| `delete` | `trash` |  |
| `delete_forever` | `trash` |  |
| `delete_outline` | `trash` |  |
| `delete_sweep` | `broom` | Sammel-Löschen (Warenkorb leeren) |
| `density_large` | `square-split-vertical` | Phosphor kennt keine Dichte-Icons; Abstufung über Zeilenzahl |
| `density_medium` | `rows` |  |
| `density_small` | `list-dashes` |  |
| `device_hub` | `share-network` |  |
| `dialpad` | `dots-nine` |  |
| `dns` | `hard-drives` |  |
| `domain_disabled` | `buildings` | Zustand steht im Text |
| `done_all` | `checks` |  |
| `egg` | `egg` |  |
| `emergency_home` | `warning-octagon` | Notfall-Hinweis des Cloud-Banners |
| `error` | `warning-circle` |  |
| `euro_symbol` | `currency-eur` |  |
| `event` | `calendar-dots` |  |
| `event_busy` | `calendar-x` |  |
| `event_note` | `calendar-dots` |  |
| `event_upcoming` | `calendar-star` |  |
| `expand_more` | `caret-down` |  |
| `flash_on` | `lightning` |  |
| `folder_open` | `folder-open` |  |
| `group_off` | `users` | Zustand steht im Text |
| `history` | `clock-counter-clockwise` |  |
| `hub` | `share-network` |  |
| `info` | `info` |  |
| `key` | `key` |  |
| `keyboard_arrow_down` | `caret-down` |  |
| `keyboard_arrow_up` | `caret-up` |  |
| `lan` | `network` |  |
| `light_mode` | `sun` |  |
| `link` | `link` |  |
| `link_off` | `link-break` |  |
| `local_cafe` | `coffee` |  |
| `local_dining` | `fork-knife` |  |
| `local_mall` | `shopping-bag` |  |
| `lock` | `lock` |  |
| `login` | `sign-in` |  |
| `logout` | `sign-out` |  |
| `lunch_dining` | `hamburger` |  |
| `menu` | `list` |  |
| `merge_type` | `arrows-merge` | Material drehte das Icon (Kombi); Phosphor hat ein eigenes Merge-Icon, keine Drehung nötig |
| `more_horiz` | `dots-three` |  |
| `no_accounts` | `user-minus` |  |
| `notifications_active` | `bell-ringing` |  |
| `palette` | `palette` |  |
| `payments` | `money` |  |
| `people` | `users` |  |
| `percent` | `percent` |  |
| `person` | `user` |  |
| `person_off` | `user-minus` |  |
| `person_remove` | `user-minus` |  |
| `phone` | `phone` |  |
| `place` | `map-pin` |  |
| `play_arrow` | `play` |  |
| `play_circle` | `play-circle` |  |
| `point_of_sale` | `cash-register` |  |
| `print` | `printer` |  |
| `print_disabled` | `printer` | Phosphor hat kein durchgestrichenes Drucker-Icon; Zustand über Farbe und Text |
| `qr_code_scanner` | `qr-code` |  |
| `receipt` | `receipt` |  |
| `receipt_long` | `receipt` |  |
| `refresh` | `arrow-clockwise` |  |
| `remove` | `minus` |  |
| `remove_done` | `list-dashes` | Kein Phosphor-Pendant zu „Erledigt entfernen"; neutrale Liste, Bedeutung trägt der Text |
| `restaurant` | `fork-knife` |  |
| `restaurant_menu` | `fork-knife` |  |
| `router` | `wifi-high` | Phosphor hat kein Router-Icon |
| `save` | `floppy-disk` |  |
| `schedule` | `clock` |  |
| `science` | `flask` |  |
| `search` | `magnifying-glass` |  |
| `search_off` | `magnifying-glass` | Zustand steht im Text |
| `security` | `shield-check` |  |
| `sell` | `tag` |  |
| `settings` | `gear` |  |
| `shield_person` | `shield-check` |  |
| `shopping_bag` | `shopping-bag` |  |
| `shopping_cart` | `shopping-cart` |  |
| `smartphone` | `device-mobile` |  |
| `store` | `storefront` |  |
| `sync` | `arrows-clockwise` |  |
| `table_restaurant` | `table` |  |
| `task_alt` | `check-circle` |  |
| `timer` | `timer` |  |
| `translate` | `translate` |  |
| `tune` | `sliders-horizontal` |  |
| `verified` | `seal-check` |  |
| `visibility` | `eye` |  |
| `visibility_off` | `eye-slash` |  |
| `warning` | `warning` |  |
| `wifi_off` | `wifi-slash` |  |
| `zoom_in` | `magnifying-glass-plus` |  |
