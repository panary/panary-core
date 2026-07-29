import type { Knex } from 'knex'

// Personalessen-Rabatt-Zuweisung: `users.staffMealDiscountId` referenziert einen
// `discounts._id` mit `isStaffMeal: true`. Gepflegt wird die Zuweisung in der
// Cloud-Admin-UI; der POS loest sie beim Erfassen einer Personalessen-Bestellung
// gegen den lokalen Rabatt-Bestand auf. Bewusst Referenz statt Wertkopie, damit
// eine Aenderung des Rabattsatzes sofort fuer alle Zugewiesenen wirkt.
//
// Die Spalte ist ZWINGEND, nicht optional: der Cloud->Edge-Pull-Apply
// (apps/api-edge/src/workers/sync-apply.ts) patcht die User-Zeile mit dem
// KOMPLETTEN Cloud-Record. Fehlt die Spalte, wirft Knex `no such column:
// staffMealDiscountId` und der Record wird REJECTED — es faellt dann nicht nur
// das neue Feld aus, sondern die gesamte User-Synchronisation dieses Tenants.
// Gleiche Klasse Fehler wie beim locations/brandId-Befund vom 2026-07-28 und
// beim mustChangePosPin-Feld (Migration 20260729093000).
//
// Kein Fremdschluessel-Constraint: die `discounts`-Zeile kann am Edge zum
// Zeitpunkt des User-Pulls noch fehlen (unterschiedliche Sync-Reihenfolge). Eine
// ins Leere laufende Referenz ist fachlich abgefangen — der POS faellt dann auf
// den Tenant-Standardrabatt und zuletzt auf „ohne Rabatt" zurueck.
//
// hasColumn-Guard, weil `users` bereits existiert und die Migration auf
// Bestandsdatenbanken in unterschiedlichem Stand laeuft.
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('users', 'staffMealDiscountId')
  if (!exists) {
    await knex.schema.alterTable('users', table => {
      table.string('staffMealDiscountId').nullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('users', 'staffMealDiscountId')
  if (exists) {
    await knex.schema.alterTable('users', table => {
      table.dropColumn('staffMealDiscountId')
    })
  }
}
