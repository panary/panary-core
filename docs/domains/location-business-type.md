---
type: Domain Concept
title: Location.businessType — Betriebstyp als kanonisches Stammdatenfeld
description: Optionales StringEnum businessType am Standort als Single Source of Truth für Storefront-Onboarding-Vorauswahl, Theme-Store-Empfehlungen und perspektivische POS-Defaults.
tags: [locations, users, storefront]
status: stable
generated: { by: claude-code/historic, at: 2026-07-06T00:00:00Z }
---

# Location.businessType (PNRY-FEAT-THEME-002)

## Problem

Der Betriebstyp (Restaurant, Café & Bäckerei, …) wurde nirgendwo als Stammdatum
erfasst — der Storefront-Onboarding-Wizard in panary-cloud fragte ihn ephemer ab
und verwarf die Antwort. Für Wizard-Vorauswahl, Theme-Store-Empfehlungen und
perspektivische POS-Defaults braucht es eine Single Source of Truth.

## Entscheidung

`businessType` als **optionales** StringEnum-Feld auf dem Location-Schema
(`libs/domains/locations/domain/src/lib/location.schema.ts`,
`LocationBusinessType`): RESTAURANT_CLASSIC · CAFE_BAKERY · TAKEOUT_DELIVERY ·
BAR_NIGHTLIFE · FOODTRUCK_STREETFOOD · FINE_DINING.

Am **Standort** (nicht Tenant), weil ein Multi-Location-Tenant unterschiedliche
Betriebstypen führen kann und Locations der Sync-Master Richtung Cloud sind.
Optional ohne Default: Bestands-Locations pflegen den Wert über den
Storefront-Wizard nach (kein Backfill).

## Konsequenzen

- Additive Knex-Migration `20260706120000_locations_business_type.ts`
  (nullable TEXT-Spalte).
- `setup-client`: Betriebstyp-Pflichtauswahl im Einrichtungsassistenten
  (de/en/tr); Wert wird beim Edge-Bootstrap auf die Location gestempelt
  (`apps/api-edge/src/main.ts`).
- In `locationDataSchema` + Query-Whitelist aufgenommen; Patch via
  `Type.Partial` automatisch.
- panary-cloud liest/patcht das Feld über den bestehenden locations-Service
  (Scaffold-Service stempelt es beim Onboarding); Cloud-Pin-Bump nötig.
- Im selben Zug: RBAC-Einträge `STOREFRONT_PRESET_LIBRARY` (Platform MANAGE /
  Tenant READ), `STOREFRONT_SCAFFOLD` (OWNER/MANAGER CREATE),
  `STOREFRONT_THEME_REQUESTS` (Tenant CREATE+READ, Admin MANAGE, Support READ)
  für die neuen Cloud-Services des Onboarding-Wizards v2 —
  Details: panary-cloud `docs/domains/storefront-onboarding-wizard-v2.md`.
