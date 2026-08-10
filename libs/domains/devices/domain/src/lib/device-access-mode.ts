// Geraete-Zuweisung (PNRY-FEAT-DEVICE-ASSIGNMENT-001) — Single Source of Truth
// fuer die Frage „wer darf sich an diesem Geraet anmelden?".
//
// Ein Geraet ist entweder `shared` (Theken-Terminal, jeder POS-Benutzer des
// Standorts) oder `assigned` (Diensthandy, 1..MAX_ASSIGNED_USER_IDS
// Mitarbeiter). Durchgesetzt wird das serverseitig im `userQueryResolver` und
// auf `verifyPin` (apps/api-edge) — der POS-Umbau ist reine UX, keine
// Sicherheitsgrenze.
//
// Framework-agnostisch (kein Feathers, kein Angular): dieselben Regeln laufen
// im Edge-Hook, im Admin-Client und im POS. Rollen bewusst als String-Literale
// statt Import aus @panary/users/domain — die devices-Domain haengt sonst im
// Publish-Build an der users-Domain (Cross-Lib-Wiring, CLAUDE.md §2.1). Muster
// und Begruendung identisch zu device-self-patch-policy.ts; der
// Invarianten-Test in apps/api-edge/src/hooks/device-access-exempt-roles.spec.ts
// lockt die Werte gegen POS_AUTHORIZING_ROLES.

/** Zugriffsmodus eines Geraets. */
export const DeviceAccessMode = {
  /** Jeder POS-Benutzer des Standorts (heutiges Verhalten, Default). */
  SHARED: 'shared',
  /** Nur die in `assignedUserIds` gelisteten Mitarbeiter. */
  ASSIGNED: 'assigned',
} as const
export type DeviceAccessModeValue = (typeof DeviceAccessMode)[keyof typeof DeviceAccessMode]

/**
 * Abwaertskompatibilitaets-Garantie: Bestandsgeraete haben das Feld nicht
 * (`undefined`/`NULL`) und verhalten sich unveraendert. Die Migration setzt
 * daher bewusst KEINEN DB-Default und macht keinen Backfill — die Umsetzung
 * `NULL → shared` lebt ausschliesslich hier.
 */
export const DEFAULT_DEVICE_ACCESS_MODE: DeviceAccessModeValue = DeviceAccessMode.SHARED

/** Obergrenze zugewiesener Mitarbeiter je Geraet. */
export const MAX_ASSIGNED_USER_IDS = 5

/**
 * Rollen, die auf einem zugewiesenen Geraet trotzdem sichtbar bleiben und sich
 * anmelden duerfen. Ohne sie waeren die drei Notfallpfade tot — Storno-Freigabe,
 * Kassenabschluss-Freigabe und vor allem das **Entkoppeln**, das sonst
 * unwiderruflich blockiert waere.
 *
 * Muss `POS_AUTHORIZING_ROLES` (@panary/users/domain) enthalten; der
 * Invarianten-Test in apps/api-edge lockt das (die devices-Domain darf die
 * users-Domain nicht importieren). Der erlaubte Personenkreis eines
 * zugewiesenen Geraets ist immer `assignedUserIds ∪ DEVICE_ACCESS_EXEMPT_ROLES`.
 */
export const DEVICE_ACCESS_EXEMPT_ROLES: ReadonlySet<string> = new Set<string>([
  'platform:owner',
  'platform:admin',
  'platform:support',
  'tenant:owner',
  'tenant:manager',
  'tenant:technician',
])

/** Minimaler Ausschnitt eines Geraete-Datensatzes fuer die Zuweisungs-Logik. */
export interface DeviceAccessState {
  deviceAccessMode?: unknown
  assignedUserIds?: unknown
}

/**
 * Normalisiert den gespeicherten Modus. Alles ausser dem exakten Literal
 * `assigned` faellt auf `shared` zurueck — auch `null`, Tippfehler und
 * unbekannte Zukunftswerte eines neueren Clients. Bewusst nachsichtig: ein
 * unlesbarer Modus darf ein Terminal niemals aussperren. Die strikte Pruefung
 * sitzt auf dem Schreibpfad (`checkDeviceAssignmentWrite`).
 */
export const resolveDeviceAccessMode = (device: DeviceAccessState | null | undefined): DeviceAccessModeValue =>
  device?.deviceAccessMode === DeviceAccessMode.ASSIGNED ? DeviceAccessMode.ASSIGNED : DEFAULT_DEVICE_ACCESS_MODE

/** true, wenn das Geraet auf bestimmte Mitarbeiter eingeschraenkt ist. */
export const isDeviceAssigned = (device: DeviceAccessState | null | undefined): boolean =>
  resolveDeviceAccessMode(device) === DeviceAccessMode.ASSIGNED

/**
 * Liest die zugewiesenen User-IDs als saubere, duplikatfreie Liste.
 * Alles Unbrauchbare (kein Array, leere Strings, Nicht-Strings) faellt raus.
 *
 * Akzeptiert zusaetzlich die JSON-String-Form: am Edge liegt das Feld als TEXT
 * in SQLite und wird normalerweise von `getJsonFieldHooks` geparst — laeuft ein
 * Datensatz einmal an den Hooks vorbei, ist ein geparster Wert deutlich besser
 * als eine leere Liste, die das Geraet fail-closed komplett aussperren wuerde.
 */
export const resolveAssignedUserIds = (device: DeviceAccessState | null | undefined): string[] => {
  const raw = device?.assignedUserIds
  const list = typeof raw === 'string' ? safeParseJsonArray(raw) : raw
  if (!Array.isArray(list)) return []

  const seen = new Set<string>()
  for (const entry of list) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed) seen.add(trimmed)
  }
  return [...seen]
}

const safeParseJsonArray = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Steuert das Personalnummer-Stempel-Panel auf dem Login-Screen: auf einem
 * zugewiesenen Geraet ergibt eine Liste aller Personalnummern keinen Sinn mehr.
 *
 * Bewusst UI-Kosmetik — `users.checkin` prueft die Personalnummer serverseitig
 * nicht (eigenes Ticket). Das `users.find`-Scoping schliesst auf zugewiesenen
 * Geraeten den bequemen Weg mit, nicht den Endpunkt.
 */
export const isTimeClockPanelEnabled = (device: DeviceAccessState | null | undefined): boolean =>
  !isDeviceAssigned(device)

/**
 * Verengt einen `_id`-Query-Wert auf die erlaubten IDs. Wird im
 * `userQueryResolver` angewendet und greift dadurch fuer `find` UND `get`
 * (sonst waere get-by-id der Umweg um das Scoping).
 *
 * Fail-closed: Das Ergebnis ist **immer** eine explizite `$in`-Liste, die
 * Teilmenge von `allowedIds` ist. Negierende oder unbekannte Operatoren
 * (`$ne`, `$nin`, …) werden dabei verworfen statt durchgereicht — sie koennten
 * die Menge nicht erweitern, aber ihre Semantik haengt am Adapter, und ein
 * still falsch ausgewerteter Operator waere hier ein Datenleck. Der Aufrufer
 * bekommt dann hoechstens mehr Zeilen als angefragt, nie andere.
 */
export const intersectAllowedIds = (value: unknown, allowedIds: readonly string[]): { $in: string[] } => {
  const allowed = new Set(allowedIds)

  if (typeof value === 'string') {
    return { $in: allowed.has(value) ? [value] : [] }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const requested = (value as Record<string, unknown>)['$in']
    if (Array.isArray(requested)) {
      return { $in: requested.filter((id): id is string => typeof id === 'string' && allowed.has(id)) }
    }
  }

  return { $in: [...allowed] }
}

//#region Schreibpfad-Validierung
/** Felder, deren Aenderung eine Zuweisungs-Entscheidung ist. */
export const DEVICE_ASSIGNMENT_FIELDS = ['deviceAccessMode', 'assignedUserIds'] as const

export interface DeviceAssignmentViolation {
  reason: 'FORBIDDEN_ROLE' | 'INVALID_MODE' | 'INVALID_IDS' | 'DUPLICATE_IDS' | 'TOO_MANY_IDS' | 'EMPTY_ASSIGNMENT'
  /** Client-stabile Meldung — Adapter werfen sie unveraendert als BadRequest/Forbidden. */
  message: string
}

export interface DeviceAssignmentActor {
  role?: string
  /** true bei internen Aufrufen (`provider: undefined`) — Rollen-Gate entfaellt. */
  internal?: boolean
}

/** true, wenn der Schreib-Body ueberhaupt eines der Zuweisungs-Felder beruehrt. */
export const touchesDeviceAssignment = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') return false
  return DEVICE_ASSIGNMENT_FIELDS.some(field => field in (data as Record<string, unknown>))
}

/**
 * Prueft einen `create`/`patch`-Body auf den Zuweisungs-Feldern. Liefert `null`,
 * wenn der Write erlaubt ist (oder die Felder gar nicht beruehrt), sonst die
 * erste Verletzung.
 *
 * `current` ist der Bestand des Ziel-Datensatzes (bei `create` `undefined`).
 * Er wird gebraucht, weil ein PATCH nur eines der beiden Felder tragen kann:
 * `{ assignedUserIds: [] }` auf einem bereits zugewiesenen Geraet ergaebe
 * „assigned mit niemandem" — also ein dauerhaft ausgesperrtes Terminal. Die
 * Zusammenfuehrung gehoert deshalb hierher und nicht in den Hook.
 */
export const checkDeviceAssignmentWrite = (
  actor: DeviceAssignmentActor | undefined,
  data: unknown,
  current?: DeviceAccessState | null,
): DeviceAssignmentViolation | null => {
  if (!touchesDeviceAssignment(data)) return null

  if (!actor?.internal && !(actor?.role && DEVICE_ACCESS_EXEMPT_ROLES.has(actor.role))) {
    return {
      reason: 'FORBIDDEN_ROLE',
      message: 'Die Geraete-Zuweisung kann nur von einer berechtigten Rolle geaendert werden.',
    }
  }

  const body = data as Record<string, unknown>
  const modeTouched = 'deviceAccessMode' in body
  const idsTouched = 'assignedUserIds' in body

  if (modeTouched && body['deviceAccessMode'] !== undefined) {
    const mode = body['deviceAccessMode']
    if (mode !== DeviceAccessMode.SHARED && mode !== DeviceAccessMode.ASSIGNED) {
      return {
        reason: 'INVALID_MODE',
        message: `Unbekannter Zugriffsmodus. Erlaubt: ${Object.values(DeviceAccessMode).join(', ')}.`,
      }
    }
  }

  if (idsTouched && body['assignedUserIds'] !== undefined) {
    const raw = body['assignedUserIds']
    if (!Array.isArray(raw) || raw.some(id => typeof id !== 'string' || !id.trim())) {
      return { reason: 'INVALID_IDS', message: 'Zugewiesene Mitarbeiter muessen als Liste von IDs uebergeben werden.' }
    }
    const unique = new Set(raw.map(id => (id as string).trim()))
    if (unique.size !== raw.length) {
      return { reason: 'DUPLICATE_IDS', message: 'Ein Mitarbeiter kann einem Geraet nur einmal zugewiesen werden.' }
    }
    if (unique.size > MAX_ASSIGNED_USER_IDS) {
      return {
        reason: 'TOO_MANY_IDS',
        message: `Einem Geraet koennen hoechstens ${MAX_ASSIGNED_USER_IDS} Mitarbeiter zugewiesen werden.`,
      }
    }
  }

  // Effektiver Zustand NACH dem Write — nur so faellt der Teil-Patch auf.
  const effective: DeviceAccessState = {
    deviceAccessMode: modeTouched ? body['deviceAccessMode'] : current?.deviceAccessMode,
    assignedUserIds: idsTouched ? body['assignedUserIds'] : current?.assignedUserIds,
  }

  // Fail-closed statt stillem Downgrade: `assigned` ohne Mitarbeiter bedeutet
  // NIEMAND. Wuerde der Modus stattdessen aus der Listenlaenge abgeleitet,
  // fiele ein Geraet beim Entfernen des letzten Mitarbeiters still auf `shared`
  // zurueck — auf dem Diensthandy erschiene ploetzlich die gesamte Belegschaft.
  if (isDeviceAssigned(effective) && resolveAssignedUserIds(effective).length === 0) {
    return {
      reason: 'EMPTY_ASSIGNMENT',
      message: 'Ein zugewiesenes Geraet braucht mindestens einen Mitarbeiter.',
    }
  }

  return null
}
//#endregion
