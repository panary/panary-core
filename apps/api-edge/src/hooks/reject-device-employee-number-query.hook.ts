// Personalnummer nicht als Suchschluessel fuer Geraete (panary/panary-core#1199).
//
// #1196 liefert die Nummer nicht mehr an Geraete aus, aber ein Filter `employeeNumber` auf `users.find` waere ein
// Orakel: Das Geraet probierte Nummern durch und erkaenne an Treffer/kein Treffer den Mitarbeiter, am Limiter von
// `stampByEmployeeNumber` vorbei. Abgewiesen wird der Schluessel in jeder Verschachtelung (`$or`, `$and`, Operator-
// Objekte) und als Sortierung. Interne Aufrufe (`provider: undefined`) bleiben frei: `resolveStampTarget` sucht so.
import { Forbidden } from '@feathersjs/errors'

import type { HookContext } from '../declarations'

const EMPLOYEE_NUMBER_KEY = 'employeeNumber'
const MAX_DEPTH = 8

export const EMPLOYEE_NUMBER_QUERY_REJECTED = 'EMPLOYEE_NUMBER_QUERY_REJECTED'

const mentionsEmployeeNumber = (value: unknown, depth = 0): boolean => {
  if (depth > MAX_DEPTH) return true // fail-closed: so tief baut niemand eine legitime Query
  if (Array.isArray(value)) return value.some(entry => mentionsEmployeeNumber(entry, depth + 1))
  if (!value || typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => key === EMPLOYEE_NUMBER_KEY || mentionsEmployeeNumber(nested, depth + 1),
  )
}

export const rejectDeviceEmployeeNumberQuery = async (context: HookContext) => {
  const { provider, user, query } = context.params as {
    provider?: string
    user?: { role?: string }
    query?: Record<string, unknown>
  }
  if (!provider || !user?.role?.startsWith('device:') || !query) return context

  // `$select` bleibt frei: Der Resolver entfernt das Feld ohnehin aus dem Ergebnis.
  const { $select: _select, ...rest } = query
  if (mentionsEmployeeNumber(rest)) {
    throw new Forbidden('Suche nach der Personalnummer ist fuer Geraete nicht zulaessig.', {
      code: EMPLOYEE_NUMBER_QUERY_REJECTED,
    })
  }
  return context
}
