import type { Knex } from 'knex'

// Re-Verifikation nach langer Offline-Phase (Issue #325, ADR 0043).
//
// `reverifyOfflineSince` haelt den Zeitpunkt des letzten Kontakts VOR der Pause,
// solange eine Bestaetigung aussteht. NULL heisst „nichts offen".
//
// 🚨 Die Spalte existiert, weil der Zustand NICHT aus `lastUsedAt` ableitbar
// ist: Beide Auth-Pfade (WS-Handshake und Print-Server-Middleware) stempeln
// `lastUsedAt` bei jedem erfolgreichen Kontakt. Ein daraus abgeleiteter Zustand
// waere unmittelbar nach dem ausloesenden Handshake wieder „nicht faellig", und
// ein automatischer Socket-Reconnect (der POS-Client reconnected unbegrenzt)
// haette die Sperre ohne jede PIN-Eingabe aufgehoben — genau im Fall, fuer den
// sie gebaut ist.
//
// BEWUSST kein Backfill: NULL ist der richtige Startwert fuer jeden
// Bestands-Schluessel. Ein Backfill aus `lastUsedAt` wuerde beim Deploy jedes
// laenger ungenutzte Zweitgeraet gleichzeitig vor den Bestaetigungsbildschirm
// schicken, ohne dass etwas vorgefallen ist. Die Bewertung uebernimmt der erste
// Handshake jedes Geraets (utils/device-reverification.ts) — und der ist
// fail-open, solange es keinen Stempel gibt.
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('apikeys', 'reverifyOfflineSince')
  if (!hasColumn) {
    await knex.schema.alterTable('apikeys', table => {
      table.string('reverifyOfflineSince').nullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('apikeys', 'reverifyOfflineSince')
  if (hasColumn) {
    await knex.schema.alterTable('apikeys', table => {
      table.dropColumn('reverifyOfflineSince')
    })
  }
}
