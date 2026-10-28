import type { Knex } from 'knex'

// Arbeitsvertrag (`users.contract`) und Jahresanspruch (`users.vacationDaysPerYear`) pflegt die Cloud-Admin-UI;
// die Cloud projiziert beide an den Edge (`user-projection.ts`, `MEMBERSHIP_FIELDS`).
//
// Die Spalten sind ZWINGEND: Der Cloud->Edge-Pull-Apply (apps/api-edge/src/workers/sync-apply.ts) patcht die
// User-Zeile mit dem KOMPLETTEN Cloud-Record. Fehlt eine Spalte, wirft Knex `no such column` und der Record wird
// REJECTED, samt PIN-Wechsel, Rolle und Status im selben Record. Der Cursor rueckt trotzdem vor, der Record kommt
// nie wieder (panary/panary-core#1180; gleiche Klasse wie 20261021120000, 20260729093000, 20260729203044).
//
// `contract` ist ein Objekt und liegt als JSON-Text (`USER_JSON_FIELDS` in services/users/users.ts).
// Beide nullable ohne Default: Bestands-User ohne Vertrag bzw. Anspruch bleiben leer. Die leere Spalte
// (`null`) erreicht die Cloud nicht als Clear: Live-Pushes strippt die Cloud (`userStripNulls`), den
// Bootstrap-Push `stripNonNullableNulls`, soweit das Schema `null` nicht kennt.
//
// Kein Import aus @panary/users/domain: Migrationen laufen als transpilierte Assets ohne Bundle.
// hasColumn-Guard, weil `users` bereits existiert und auf Bestandsdatenbanken in unterschiedlichem Stand laeuft.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('users', 'vacationDaysPerYear'))) {
    await knex.schema.alterTable('users', table => {
      table.float('vacationDaysPerYear').nullable()
    })
  }
  if (!(await knex.schema.hasColumn('users', 'contract'))) {
    await knex.schema.alterTable('users', table => {
      table.text('contract').nullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const column of ['contract', 'vacationDaysPerYear']) {
    if (await knex.schema.hasColumn('users', column)) {
      await knex.schema.alterTable('users', table => {
        table.dropColumn(column)
      })
    }
  }
}
