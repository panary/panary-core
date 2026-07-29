import type { Knex } from 'knex'

// Erzwungener POS-PIN-Wechsel: `users.mustChangePosPin` wird von der Cloud
// gesetzt, sobald ein Admin einen PIN vergibt/zuruecksetzt, und ausschliesslich
// von der `changePin`-Custom-Method wieder geloescht.
//
// Die Spalte ist ZWINGEND, nicht optional: der Cloud->Edge-Pull-Apply
// (apps/api-edge/src/workers/sync-apply.ts) patcht die User-Zeile mit dem
// KOMPLETTEN Cloud-Record. Fehlt die Spalte, wirft Knex `no such column:
// mustChangePosPin` und der Record wird REJECTED — es faellt dann nicht nur
// das neue Feld aus, sondern die gesamte User-Synchronisation dieses Tenants.
// Gleiche Klasse Fehler wie beim locations/brandId-Befund vom 2026-07-28.
//
// hasColumn-Guard, weil `users` bereits existiert und die Migration auf
// Bestandsdatenbanken in unterschiedlichem Stand laeuft.
//
// ACHTUNG fuer kuenftige Cursor-Reset-Migrationen (Muster
// 20260728150000_reset_location_pull_cursors.ts): fuer `users` ist ein
// Pull-Cursor-Reset NICHT gefahrlos. Ein Re-Pull holt den Cloud-Stand von
// posPin/mustChangePosPin bedingungslos zurueck und wuerde am Edge geaenderte,
// noch nicht gepushte PINs verwerfen.
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('users', 'mustChangePosPin')
  if (!exists) {
    await knex.schema.alterTable('users', table => {
      table.boolean('mustChangePosPin').defaultTo(false)
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('users', 'mustChangePosPin')
  if (exists) {
    await knex.schema.alterTable('users', table => {
      table.dropColumn('mustChangePosPin')
    })
  }
}
