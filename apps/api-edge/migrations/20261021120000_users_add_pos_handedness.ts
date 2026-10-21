import type { Knex } from 'knex'

// Bedienhand an der Kasse: `users.posHandedness` ('left' | 'right') bestimmt, auf
// welcher Seite der POS den Warenkorb zeigt (panary/panary-core#827). Gesetzt wird
// es vom Mitarbeiter selbst (Self-Patch) oder in der Cloud-Admin-UI.
//
// Die Spalte ist ZWINGEND, nicht optional: der Cloud->Edge-Pull-Apply
// (apps/api-edge/src/workers/sync-apply.ts) patcht die User-Zeile mit dem
// KOMPLETTEN Cloud-Record. Fehlt die Spalte, wirft Knex `no such column:
// posHandedness` und der Record wird REJECTED — samt eines im selben Record
// steckenden PIN-Wechsels (gleiche Klasse wie 20260729093000/20260729203044).
//
// Nullable OHNE Default: „nicht gewaehlt" bleibt als leere Spalte erkennbar und
// wird erst beim Lesen zu links aufgeloest (`resolvePosHandedness`). Ein Default
// 'left' wuerde jeden Bestands-User beim naechsten Push mit einem Wert
// ausliefern, den niemand gewaehlt hat — und eine Cloud ohne das Feld lehnte
// diese Pushes ab. Die leere Spalte (`null`) faellt vor dem Push weg
// (Bootstrap: `stripNonNullableNulls`, Live: Cloud-`stripNulls`).
//
// Kein Import aus @panary/users/domain: Migrationen laufen als transpilierte
// Assets ohne Bundle, die Werte-Liste prueft das Domain-Schema.
//
// hasColumn-Guard, weil `users` bereits existiert und die Migration auf
// Bestandsdatenbanken in unterschiedlichem Stand laeuft.
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('users', 'posHandedness')
  if (!exists) {
    await knex.schema.alterTable('users', table => {
      table.string('posHandedness').nullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('users', 'posHandedness')
  if (exists) {
    await knex.schema.alterTable('users', table => {
      table.dropColumn('posHandedness')
    })
  }
}
