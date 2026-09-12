import type { Knex } from 'knex'

// panary/panary-core#275 — Einmalige Heilung von Bestandsdaten: Ein Edge, dessen
// einziges Verwaltungskonto archiviert ist, bekommt seinen Zugang zurueck.
//
// Vorgeschichte: `reconcileStaleUsers` archivierte beim Initial-Pull nach dem
// Pairing garantiert das `tenant:owner`-Konto — die Rolle wird nie in die Cloud
// gepusht, kann also nie im Visibility-Snapshot stehen. Seit #187 passiert das
// nicht mehr, aber die Ausnahme dort verhindert nur NEUES Archivieren
// (`selectStaleUsersToArchive` steigt bei `status === ARCHIVED` sofort aus).
// Wer vor dem 2026-08-12 gepaart hat und auf >= v26.8.18 gehoben wird, ist
// ausgesperrt: Der Login-Guard ist dann scharf, und ohne ein zweites Konto mit
// `users: MANAGE` bleibt nur SSH + SQLite. Am 2026-09-12 real eingetreten.
//
// 🚨 Die Bedingung ist der Kern, nicht die Aktion. Reaktiviert wird NUR, wenn
// KEIN anmeldefaehiges Verwaltungskonto mehr existiert. Ein bewusst
// stillgelegter Owner bleibt stillgelegt, solange irgendein anderer Zugang
// besteht — sonst waere `ARCHIVED` fuer die maechtigste Rolle wertlos.
//
// 🚨 Und nur Rollen, die NIE gepusht werden (`SYNC_PUSH_BLOCKED_USER_ROLES`).
// Bei einem edge-lokalen `tenant:technician` traegt `ARCHIVED` echte
// Information: Die Rolle KANN gepusht werden, ihr Fehlen im Snapshot ist ein
// Signal (ADR 0028, Konsequenzen). Beim Owner ist es eine Tautologie.
//
// ⚠️ Rollen-Literale bewusst ohne Import aus `@panary/users/domain`:
// Migrationen werden als Assets kopiert und einzeln mit `--bundle=false`
// transpiliert (tools/docker/Dockerfile.edge) — keine einzige Migration in
// diesem Repo importiert einen Laufzeitwert aus einer Domain-Lib, und ein
// Auflösungsfehler wuerde in `sqlite.ts` nur geloggt, nicht geworfen: Die
// Migration fiele still aus. Dasselbe Muster wie `DEVICE_PRIVILEGED_ROLES`.
// Die Literale sind gegen die Domain-Konstanten gelockt in
// apps/api-edge/test/migrations/reactivate-locked-out-owner.spec.ts.

/** Rollen mit `users: MANAGE` laut RolePermissions-Matrix. */
export const MANAGE_ROLES: readonly string[] = ['platform:owner', 'tenant:owner', 'tenant:technician']

/** Verwaltungsrollen, die nie in die Cloud gepusht werden — nur die werden geheilt. */
export const REACTIVATABLE_ROLES: readonly string[] = ['platform:owner', 'tenant:owner']

const STATUS_ACTIVE = 'ACTIVE'
const STATUS_ARCHIVED = 'ARCHIVED'

export interface UserStatusRow {
  _id: string
  role?: string | null
  status?: string | null
}

/**
 * Reine Auswahl — ohne DB. Liefert die zu reaktivierenden Konten, oder ein
 * leeres Array, wenn noch ein Zugang besteht.
 *
 * „Anmeldefaehig" hat dieselbe Semantik wie `isLoginBlockedByStatus`: Ein
 * FEHLENDER Status laesst durch (alte Datensaetze vor Einfuehrung der Spalte).
 * Waere das hier strenger, wuerde die Migration auf einer DB mit NULL-Status
 * reaktivieren, obwohl sich der Owner anmelden kann.
 */
export const selectUsersToReactivate = (rows: readonly UserStatusRow[]): UserStatusRow[] => {
  const admins = rows.filter(row => !!row.role && MANAGE_ROLES.includes(row.role))
  const usable = admins.filter(row => !row.status || row.status === STATUS_ACTIVE)
  if (usable.length > 0) return []

  return admins.filter(row => row.status === STATUS_ARCHIVED && !!row.role && REACTIVATABLE_ROLES.includes(row.role))
}

export async function up(knex: Knex): Promise<void> {
  // Defensiv: Die Migration laeuft auch auf einer frisch angelegten DB, in der
  // `users` erst von einer spaeteren Migration entsteht — dann ist nichts zu tun.
  if (!(await knex.schema.hasTable('users'))) return
  if (!(await knex.schema.hasColumn('users', 'status'))) return

  const rows = (await knex('users').select('_id', 'role', 'status')) as UserStatusRow[]
  const toReactivate = selectUsersToReactivate(rows)
  if (toReactivate.length === 0) return

  // `updatedAt` wird mitgesetzt: Das ist eine echte Aenderung und soll im
  // Datensatz stehen. Sync-neutral, weil ausschliesslich Rollen der
  // Push-Blockliste betroffen sind — diese Konten verlassen den Edge nie.
  await knex('users')
    .whereIn(
      '_id',
      toReactivate.map(row => row._id),
    )
    .update({ status: STATUS_ACTIVE, updatedAt: new Date().toISOString() })

  // Kein `logger` in Migrationen (siehe Kommentar oben) — die Zeile muss aber
  // im Boot-Log stehen: Ein stillschweigend wieder freigeschalteter Zugang ist
  // eine sicherheitsrelevante Aenderung.
  console.warn(
    `[Migration 20260912160000] Kein anmeldefaehiges Verwaltungskonto gefunden — ` +
      `${toReactivate.length} archivierte(s) Konto/Konten reaktiviert (panary/panary-core#275): ` +
      toReactivate.map(row => `${row._id} (${row.role})`).join(', '),
  )
}

export async function down(): Promise<void> {
  // Bewusst ein No-op. Ein Rollback müsste wissen, WELCHE Konten diese
  // Migration reaktiviert hat — und das steht nirgends: `status` traegt keine
  // Herkunft. Ein pauschales Zurueck-Archivieren aller Owner wuerde genau den
  // Totalausschluss wiederherstellen, den die Migration behebt.
}
