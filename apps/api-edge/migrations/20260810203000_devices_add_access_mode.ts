import type { Knex } from 'knex'

// PNRY-FEAT-DEVICE-ASSIGNMENT-001: Ein Geraet kann optional auf einzelne
// Mitarbeiter eingeschraenkt werden. `assignedUserIds` als JSON-Text — analog
// `metadata`/`uiScale` (Serialisierung via getJsonFieldHooks im devices-Service).
//
// BEWUSST kein DB-Default und kein Backfill: `NULL` ist die
// Abwaertskompatibilitaets-Garantie fuer Bestandsgeraete. Die Umsetzung
// `NULL → shared` lebt an genau einer Stelle (resolveDeviceAccessMode in
// @panary/devices/domain) — ein DB-Default waere die zweite Wahrheit, die beim
// naechsten Modus-Wert auseinanderlaeuft.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', table => {
    table.text('deviceAccessMode').nullable() // 'shared' | 'assigned'; NULL = shared
    table.text('assignedUserIds').nullable() // string[] als JSON-String
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', table => {
    table.dropColumn('deviceAccessMode')
    table.dropColumn('assignedUserIds')
  })
}
