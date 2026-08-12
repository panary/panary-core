import { isSyncPushBlockedRole } from '@panary/users/domain'

import type { Application } from '../../declarations'

export interface ConsistencyIssue {
  severity: 'WARN' | 'ERROR'
  message: string
}

/**
 * Findet lokale User, die per Design nie ein Cloud-Pendant bekommen: Ihre Rolle
 * steht auf der Push-Blockliste (`tenant:owner`, `platform:*`), also nimmt
 * `runBootstrapEdgeToCloud` sie vom Push aus. Typischer Fall ist der initiale
 * Admin, den das Edge-Setup anlegt.
 *
 * Der Hinweis ersetzt die frueheren `external-id-missing`-Konflikte, die der
 * Merge-Modus fuer jeden dieser User erzeugte (#184) — unaufloesbar, weil kein
 * Cloud-Pendant entstehen kann. Bewusst nur ein WARN und kein automatischer
 * Eingriff: An einem `tenant:owner`-Konto entscheidet der Betreiber. Es kann
 * der einzige Zugang zum Edge-Panel sein, wenn der Cloud-Tenant unter einer
 * anderen Identitaet angelegt wurde.
 *
 * Liefert `null`, wenn es nichts zu melden gibt.
 *
 * Eigenes Modul, weil `bootstrap-report.helper` ueber `bootstrap-reports.ts`
 * die Service-Validatoren mitzieht und damit nicht isoliert testbar ist —
 * dasselbe Muster wie `truncate-master-tables.ts`.
 */
export const collectEdgeOnlyUserIssue = async (app: Application): Promise<ConsistencyIssue | null> => {
  try {
    // Adapter-API statt Knex (anders als die uebrigen Checks im Helper): ein
    // einfacher Read gehoert laut `.claude/rules/code-style.md` §6 nicht auf
    // die DB-Connection.
    const result = await app.service('users' as any).find({
      provider: undefined,
      paginate: false,
      query: { $select: ['_id', 'role', 'loginname'] },
    } as any)
    const localUsers = (Array.isArray(result) ? result : []) as Array<{ role?: string; loginname?: string }>
    const edgeOnly = localUsers.filter(user => isSyncPushBlockedRole(user.role))
    if (edgeOnly.length === 0) return null

    const names = edgeOnly
      .map(user => user.loginname)
      .filter(Boolean)
      .join(', ')
    return {
      severity: 'WARN',
      message:
        `${edgeOnly.length} lokale(r) User mit cloud-gesperrter Rolle (${names || 'ohne loginname'}) — ` +
        `existiert nur auf diesem Edge und bekommt kein Cloud-Pendant. Bewusst unangetastet gelassen; ` +
        `ggf. selbst archivieren, sobald der Cloud-Zugang steht.`,
    }
  } catch (err) {
    return {
      severity: 'WARN',
      message: `Edge-only-User-Check fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
