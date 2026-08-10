// Before-Hook fuer `devices.create` und `devices.patch`: prueft die
// Zuweisungs-Felder (PNRY-FEAT-DEVICE-ASSIGNMENT-001), BEVOR sie in der DB
// landen.
//
// Warum so streng: Die Zuweisung ist fail-closed. Eine vertippte, geloeschte
// oder fremde `userId` erzeugt kein „etwas fehlt", sondern ein Terminal, an dem
// sich niemand mehr anmelden kann — und dessen Entkoppeln nur noch ueber die
// Freigabe-Rollen laeuft. Der billigste Ort, das zu verhindern, ist der
// Schreibpfad.
//
// Registriert VOR `validateData`: Ein Verstoss gegen die Zuweisungs-Regeln soll
// mit seiner eigenen, sprechenden Meldung scheitern und nicht mit einer
// generischen Schema-Meldung.
import { BadRequest, Forbidden } from '@feathersjs/errors'

import {
  checkDeviceAssignmentWrite,
  resolveAssignedUserIds,
  touchesDeviceAssignment,
  type DeviceAccessState,
} from '@panary/devices/domain'
import { UserStatus } from '@panary/users/domain'

import type { HookContext } from '../declarations'

interface AssignableUser {
  _id?: string
  isPosUser?: boolean
  status?: string
}

const asArray = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : ((result as { data?: T[] } | undefined)?.data ?? [])

export const validateDeviceAssignment = async (context: HookContext): Promise<HookContext> => {
  if (!touchesDeviceAssignment(context.data)) return context

  const internal = !context.params.provider
  const actor = context.params.user as { role?: string; tenantId?: string } | undefined

  // Bestand laden: Ein PATCH kann nur eines der beiden Felder tragen. Ohne den
  // Bestand saehe `{ assignedUserIds: [] }` auf einem bereits zugewiesenen
  // Geraet harmlos aus — es waere „assigned mit niemandem".
  const current = await loadCurrentState(context)

  const violation = checkDeviceAssignmentWrite({ role: actor?.role, internal }, context.data, current)
  if (violation) {
    throw violation.reason === 'FORBIDDEN_ROLE' ? new Forbidden(violation.message) : new BadRequest(violation.message)
  }

  const data = context.data as Record<string, unknown>
  if (!('assignedUserIds' in data)) return context

  const ids = resolveAssignedUserIds({ assignedUserIds: data['assignedUserIds'] })
  if (ids.length === 0) return context

  // `multiTenancy` hat bei externen Aufrufen bereits gestempelt; intern
  // (Pairing-Redeem) traegt der Body die tenantId. Fehlt sie ganz, wird
  // abgelehnt statt ungefiltert zu suchen — ohne Tenant-Filter koennte ein
  // fremder Mitarbeiter zugewiesen werden.
  const tenantId = (data['tenantId'] as string | undefined) ?? actor?.tenantId
  if (!tenantId) {
    throw new BadRequest('Mandant des Geraets ist nicht bestimmbar — Zuweisung abgelehnt.')
  }

  await assertUsersAssignable(context, ids, tenantId)
  return context
}

const loadCurrentState = async (context: HookContext): Promise<DeviceAccessState | undefined> => {
  if (context.method !== 'patch' || context.id === null || context.id === undefined) return undefined
  // NotFound laeuft bewusst durch — der eigentliche Patch scheiterte identisch.
  return (await context.app.service('devices').get(context.id, { provider: undefined })) as DeviceAccessState
}

const assertUsersAssignable = async (context: HookContext, ids: string[], tenantId: string): Promise<void> => {
  const result = await context.app.service('users').find({
    query: { _id: { $in: ids }, tenantId, $limit: ids.length },
    provider: undefined,
  })
  const users = asArray<AssignableUser>(result)
  const byId = new Map(users.map(user => [user._id, user]))

  for (const id of ids) {
    const user = byId.get(id)
    // Fremder Mandant und „gibt es nicht" fallen bewusst zusammen: Der
    // Tenant-Filter oben macht beides ununterscheidbar, und das ist richtig so.
    if (!user) {
      throw new BadRequest(`Mitarbeiter ${id} existiert nicht in diesem Mandanten.`)
    }
    if (!user.isPosUser) {
      throw new BadRequest(`Mitarbeiter ${id} ist kein POS-Benutzer und kann sich am Terminal nicht anmelden.`)
    }
    // Nicht im Plan enumeriert, aber dieselbe Fehlerklasse: Ein archivierter
    // Mitarbeiter erzeugt beim Zuweisen sofort das Terminal, an das niemand
    // mehr herankommt. Das nachtraegliche Archivieren bleibt offen (eigenes
    // Ticket) — der neue Fehler wird hier wenigstens nicht erst gebaut.
    if (user.status && user.status !== UserStatus.ACTIVE) {
      throw new BadRequest(`Mitarbeiter ${id} ist nicht aktiv und kann einem Geraet nicht zugewiesen werden.`)
    }
  }
}
