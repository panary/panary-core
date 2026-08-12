// Entscheidung, welche lokalen User die Cloud-Reconciliation archivieren darf
// (panary/panary-core#187).
//
// Bewusst als reine Funktion neben dem Scheduler: Die Regel ist die eigentliche
// Sicherung gegen ein ausgesperrtes Edge-Panel, der Rest von
// `reconcileStaleUsers` ist Feathers-Mechanik. Getestet wird sie in
// `stale-user-reconciliation.spec.ts`.
import { isSyncPushBlockedRole, UserStatus } from '@panary/users/domain'

export interface ReconcilableUser {
  _id: string
  role?: string | null
  status?: string | null
}

export interface StaleUserDecision {
  /** IDs, die auf `ARCHIVED` gesetzt werden sollen. */
  toArchive: string[]
  /**
   * IDs, die nur deshalb verschont wurden, weil ihre Rolle nie zur Cloud
   * gepusht wird. Der Aufrufer loggt sie — ein stiller Skip waere hier die
   * schlechtere Wahl, weil die Zahl bei einem echten Datenfehler auffaellt.
   */
  keptUnpushable: string[]
}

/**
 * Waehlt aus dem lokalen Bestand die User, deren Abwesenheit im
 * Visibility-Snapshot der Cloud tatsaechlich „existiert dort nicht mehr"
 * bedeutet.
 *
 * 🚨 **Rollen der Push-Blockliste sind ausgenommen.** `SYNC_PUSH_BLOCKED_USER_ROLES`
 * (u. a. `tenant:owner`) wird per Design nie zur Cloud gepusht — ein solches
 * Konto kann dort kein Pendant haben und steht deshalb **nie** im Snapshot.
 * Seine Abwesenheit ist eine Tautologie, kein Signal. Ohne diese Ausnahme
 * archiviert der erste Initial-Pull nach dem Pairing garantiert den
 * Edge-Owner — und seit #187 sperrt `ARCHIVED` auch wirklich aus.
 *
 * Das ist kein theoretischer Fall: Nach ADR 0027 bleiben verwaiste
 * Owner-Konten nach einem Merge-Bootstrap bewusst stehen, weil sie der einzige
 * Zugang zum Edge-Panel sein koennen, wenn der Cloud-Tenant unter einer anderen
 * Identitaet angelegt wurde. Genau die haette die Reconciliation eingesammelt.
 *
 * Idempotent: bereits archivierte User tauchen nicht erneut auf.
 */
export const selectStaleUsersToArchive = (
  localUsers: ReadonlyArray<ReconcilableUser>,
  cloudVisibleIds: ReadonlyArray<string>,
): StaleUserDecision => {
  const visible = new Set(cloudVisibleIds)
  const toArchive: string[] = []
  const keptUnpushable: string[] = []

  for (const user of localUsers) {
    if (!user?._id) continue
    if (visible.has(user._id)) continue
    if (user.status === UserStatus.ARCHIVED) continue
    if (isSyncPushBlockedRole(user.role)) {
      keptUnpushable.push(user._id)
      continue
    }
    toArchive.push(user._id)
  }

  return { toArchive, keptUnpushable }
}
