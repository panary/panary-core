// Migration: cloud-connection um die zuletzt gesehenen Mindestversionen erweitern (core#1440, ADR 0070).
//
// Die Cloud liefert `requiredEdgeMinVersion` und `requiredPosMinVersion` in der Heartbeat-Antwort, aber nur,
// wenn Michael sie von Hand gesetzt hat. Der Edge muss den letzten Wert behalten: Er ist der einzige Ort, der
// mit dem POS auch offline spricht, und ohne gespeicherten Wert verschwände der Hinweis mit jedem Cloud-Ausfall.
//
// Bestandsrecords bekommen NULL — „keine Mindestversion bekannt", der Normalfall bis zum ersten Heartbeat
// nach dem Update. Reine Auskunftsspalten: Nichts im Edge sperrt oder stoppt etwas auf ihrer Grundlage.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.string('requiredEdgeMinVersion', 50).nullable()
    table.string('requiredPosMinVersion', 50).nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.dropColumn('requiredEdgeMinVersion')
    table.dropColumn('requiredPosMinVersion')
  })
}
