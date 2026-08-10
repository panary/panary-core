// Prueft, ob Mitarbeiter einem Geraet zugewiesen werden duerfen
// (PNRY-FEAT-DEVICE-ASSIGNMENT-001).
//
// Geteilt von zwei Schreibpfaden: dem `devices`-Validate-Hook
// (validate-device-assignment.hook.ts) und der Pairing-Route
// (device-pairing.ts, `request-code`). Beide muessen dieselbe Antwort geben —
// eine Zuweisung, die das Pairing durchlaesst und der Hook ablehnt, waere ein
// Geraet, das sich beim Anlegen selbst zerlegt.
//
// Warum ueberhaupt so streng: Die Zuweisung ist fail-closed. Eine ungueltige
// `userId` erzeugt kein „etwas fehlt", sondern ein Terminal, an dem sich
// niemand mehr anmelden kann.
import { BadRequest } from '@feathersjs/errors'

import { UserStatus } from '@panary/users/domain'

import type { Application } from '../declarations'

export interface AssignableUser {
  _id?: string
  firstName?: string
  lastName?: string
  isPosUser?: boolean
  status?: string
}

const asArray = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : ((result as { data?: T[] } | undefined)?.data ?? [])

/**
 * Wirft `BadRequest`, sobald eine der IDs nicht zuweisbar ist. Liefert sonst
 * die geladenen Datensaetze in der Reihenfolge von `ids` — der Pairing-Pfad
 * baut daraus die Anzeige-Liste, ohne ein zweites Mal zu lesen.
 *
 * `tenantId` ist Pflicht: Der Lookup laeuft intern (`provider: undefined`), wo
 * `multiTenancy` NICHT stempelt. Ohne den Filter liesse sich ein Mitarbeiter
 * eines fremden Mandanten zuweisen.
 */
export const assertUsersAssignable = async (
  app: Application,
  ids: string[],
  tenantId: string,
): Promise<AssignableUser[]> => {
  if (ids.length === 0) return []

  const result = await app.service('users').find({
    query: { _id: { $in: ids }, tenantId, $limit: ids.length },
    provider: undefined,
  })
  const byId = new Map(asArray<AssignableUser>(result).map(user => [user._id, user]))

  return ids.map(id => {
    const user = byId.get(id)
    // „Fremder Mandant" und „gibt es nicht" fallen bewusst zusammen: Der
    // Tenant-Filter oben macht beides ununterscheidbar, und das ist richtig so.
    if (!user) {
      throw new BadRequest(`Mitarbeiter ${id} existiert nicht in diesem Mandanten.`)
    }
    if (!user.isPosUser) {
      throw new BadRequest(`Mitarbeiter ${id} ist kein POS-Benutzer und kann sich am Terminal nicht anmelden.`)
    }
    // Ein archivierter Mitarbeiter erzeugt beim Zuweisen sofort das Terminal,
    // an das niemand mehr herankommt. Das NACHTRAEGLICHE Archivieren bleibt
    // offen (eigenes Ticket) — der neue Fehler wird hier wenigstens nicht erst
    // gebaut.
    if (user.status && user.status !== UserStatus.ACTIVE) {
      throw new BadRequest(`Mitarbeiter ${id} ist nicht aktiv und kann einem Geraet nicht zugewiesen werden.`)
    }
    return user
  })
}
