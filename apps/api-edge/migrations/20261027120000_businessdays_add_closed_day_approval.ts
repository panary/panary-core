import type { Knex } from 'knex'

// Ruhetag-Freigabe am Geschaeftstag (panary/panary-core#1133, ADR 0062): wer
// (userId, Rolle) wann fuer welchen Kalendertag den Verkauf an einem laut
// Oeffnungszeiten geschlossenen Tag freigegeben hat. Gesetzt von
// `businessdays.approveClosedDay`.
//
// Flache Spalten wie die TSE-Felder (kein JSON-Hook im businessdays-Service).
// Nullable ohne Default: Bestandstage bleiben leer, das heisst „keine Freigabe".
//
// Die Spalten sind ZWINGEND, nicht optional: Der Cloud->Edge-Pull-Apply
// (`workers/sync-apply.ts`) patcht den Geschaeftstag mit dem Cloud-Record. Setzt
// die Cloud die Freigabe selbst (Eroeffnung im Cloud-Wizard, panary/panary-cloud#1471),
// wirft Knex ohne Spalte `no such column` und der Record wird REJECTED.
//
// hasColumn-Guard je Spalte, weil `businessdays` bereits existiert und die
// Migration auf Bestandsdatenbanken in unterschiedlichem Stand laeuft.
const COLUMNS = ['openedOnClosedDayBy', 'openedOnClosedDayRole', 'openedOnClosedDayAt', 'openedOnClosedDayDate']

export async function up(knex: Knex): Promise<void> {
  for (const column of COLUMNS) {
    if (await knex.schema.hasColumn('businessdays', column)) continue
    await knex.schema.alterTable('businessdays', table => {
      table.string(column).nullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const column of COLUMNS) {
    if (!(await knex.schema.hasColumn('businessdays', column))) continue
    await knex.schema.alterTable('businessdays', table => {
      table.dropColumn(column)
    })
  }
}
