// Personalnummer nie an Geraete (panary/panary-core#1196): Hilfen fuer die Wege, an denen `resolveExternal` des
// Aufrufers nicht greift, weil das Dispatch-Objekt schon aus einem inneren Aufruf ohne User stammt.

const DEVICE_ROLE_PREFIX = 'device:'

/**
 * Kopie ohne das vorbelegte Dispatch-Symbol (nicht aufzaehlbar, ein Spread laesst es fallen). Dann laeuft der
 * `resolveExternal` des aeusseren, echten Aufrufers mit dessen Kontext, statt das Dispatch des inneren Aufrufs
 * (`provider: undefined`, kein User) unveraendert zu uebernehmen.
 */
export const withoutDispatch = <TRecord extends object>(record: TRecord): TRecord => ({ ...record })

/** Verbindung eines Geraets (API-Key-Authentifizierung setzt `deviceRole`, `channels.ts`). */
export const isDeviceConnection = (connection: unknown): boolean => {
  const role = (connection as { deviceRole?: unknown } | undefined)?.deviceRole
  return typeof role === 'string' && role.startsWith(DEVICE_ROLE_PREFIX)
}

/** Event-Nutzlast fuer Geraete: ohne `employeeNumber`, einzeln oder als Liste. */
export const stripEmployeeNumber = (payload: unknown): unknown => {
  if (Array.isArray(payload)) return payload.map(stripEmployeeNumber)
  if (!payload || typeof payload !== 'object') return payload
  const { employeeNumber: _omitted, ...rest } = payload as Record<string, unknown>
  return rest
}
