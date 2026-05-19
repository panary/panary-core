// Hotfix-Migration 2026-05-19: Backfill `nextAttemptAt` fuer existierende
// sync-outbox-Eintraege, die vor dem Sync-Hardening-Rollout angelegt wurden.
//
// Hintergrund: Die Migration `20260519000001_sync_outbox_retry_fields.ts`
// legte die Spalte `nextAttemptAt` als nullable an, in der Annahme dass NULL
// "sofort faellig" bedeutet. Der Worker-Query nutzte
// `$or: [{ nextAttemptAt: { $lte: now } }, { nextAttemptAt: null }]`, aber
// das `null`-Predicat wird von AJV `Type.Optional(Type.String({...date-time}))`
// als `must match format "date-time"` abgelehnt → Push-Worker crasht mit
// BadRequest, Sync steht.
//
// Loesung: NULL-Werte bei `status='pending'` auf `occurredAt` setzen
// (= sofort faellig beim naechsten Tick). Neue Eintraege bekommen den Wert
// im sync-outbox-DataResolver (Default = occurredAt). Worker-Query
// vereinfacht zu `nextAttemptAt: { $lte: now }`.
//
// Acked/Rejected-Eintraege ignorieren wir bewusst — die werden vom Worker
// nicht mehr gezogen, NULL dort hat keine funktionale Auswirkung. Audit-
// Cleanup raeumt acked-Eintraege ohnehin spaeter weg.
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `UPDATE "sync-outbox" SET "nextAttemptAt" = "occurredAt"
     WHERE "nextAttemptAt" IS NULL AND status = 'pending'`,
  )
}

export async function down(_knex: Knex): Promise<void> {
  // Kein Down-Path: Backfill ist datenrettend (kein Schema-Aenderung), und
  // ein Reset auf NULL waere destruktiv ohne den alten Worker-Query-Code zu
  // restaurieren. Bei Bedarf manuell: UPDATE … SET nextAttemptAt = NULL.
}
