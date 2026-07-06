// Migration: locations.businessType hinzufügen (PNRY-FEAT-THEME-002).
//
// Betriebstyp des Standorts als kanonisches Stammdatenfeld — Single Source of
// Truth für die Storefront-Onboarding-Vorauswahl, Theme-Store-Empfehlungen und
// perspektivisch POS-Defaults. Werte: RESTAURANT_CLASSIC | CAFE_BAKERY |
// TAKEOUT_DELIVERY | BAR_NIGHTLIFE | FOODTRUCK_STREETFOOD | FINE_DINING.
//
// Bewusst nullable OHNE Default: Bestands-Locations haben keinen Betriebstyp;
// der Storefront-Wizard erfasst ihn nach (kein Backfill nötig).

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', table => {
    table.string('businessType').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', table => {
    table.dropColumn('businessType')
  })
}
