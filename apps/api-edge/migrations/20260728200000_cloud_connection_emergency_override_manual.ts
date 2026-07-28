// Migration: cloud-connection um die Steuerfelder fuer den manuellen
// Notfall-Modus erweitern.
//
// Hintergrund: Bisher konnte der Notfall-Modus (ADR 0001) ausschliesslich
// automatisch vom Heartbeat-Watchdog gesetzt werden. Mit dem Kontroll-Switch im
// Edge-Admin muss ein einzelnes Boolean zwei zusaetzliche Fragen beantworten,
// sonst ueberschreibt die Automatik jede Operator-Entscheidung binnen Sekunden:
//
//  - `emergencyOverrideSource`: Der Reconcile-Fast-Path deaktiviert den Modus,
//    sobald keine Overrides mehr offen sind — ohne Cloud-Call. Eine manuelle
//    Aktivierung waere nach einem Sync-Tick wieder weg.
//  - `emergencyOverrideSuppressedUntil`: `consecutiveHeartbeatFailures` wird nur
//    bei einem ERFOLGREICHEN Heartbeat auf 0 gesetzt. Nach einer manuellen
//    Deaktivierung waehrend des Ausfalls liegt der Zaehler weiterhin ueber der
//    Schwelle — der naechste Fehlversuch wuerde sofort re-aktivieren.
//
// Edge-only: Diese Felder werden NICHT zur Cloud synct.

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.string('emergencyOverrideSource').nullable()
    table.string('emergencyOverrideSuppressedUntil').nullable()
  })

  // Bestandszeilen mit aktivem Modus stammen zwangslaeufig aus der Automatik —
  // einen manuellen Weg gab es vorher nicht.
  await knex('cloud-connection').where({ emergencyOverride: true }).update({
    emergencyOverrideSource: 'AUTO',
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cloud-connection', table => {
    table.dropColumn('emergencyOverrideSource')
    table.dropColumn('emergencyOverrideSuppressedUntil')
  })
}
