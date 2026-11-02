/**
 * Methoden, die der POS-Client je Service am Feathers-Socket-Client registriert. Eine nicht registrierte
 * Custom-Method ist clientseitig nicht vorhanden: Am cloud-direct-POS scheiterte so „Geschäftstag eröffnen" mit
 * „service.openDay is not a function" (panary/panary-core#1120).
 *
 * Bewusst framework-frei und über den eigenen Einstieg `@panary/shared/data-access/client-methods` erreichbar:
 * Die Invarianten-Spec der Edge (`apps/api-edge/src/services/client-methods-invariant.spec.ts`) prüft gegen genau
 * diese Listen, dass jede Custom-Method des Clients dort existiert (panary/panary-core#1165). Ein Abgleich gegen
 * die Cloud gehört nicht dazu.
 */

const STANDARD_METHODS = ['find', 'get', 'create', 'update', 'patch', 'remove'] as const

/** Die Feathers-Standardmethoden — die Invarianten-Spec nimmt sie aus und prüft nur Custom-Methoden. */
export const CLIENT_STANDARD_METHODS: readonly string[] = STANDARD_METHODS

/**
 * Methoden am Service `businessdays`. `discardOrphanDay` bleibt bewusst unregistriert: Nur der Admin-Client ruft
 * es per REST. Exportiert, damit die Spec von `BusinessDayService` gegen genau diese Liste läuft.
 */
export const BUSINESSDAYS_CLIENT_METHODS = [
  ...STANDARD_METHODS,
  'openDay',
  'closeDay',
  'refreshClosingStatus',
  'approveClosedDay',
  'getClosedDayStatus',
] as const

export const CLIENT_SERVICE_METHODS = {
  users: [
    ...STANDARD_METHODS,
    'checkin',
    'checkout',
    'startBreak',
    'endBreak',
    'verifyPin',
    'changePin',
    // Bedienhand am Terminal (#833).
    'setPosHandedness',
    // Stempeln per Personalnummer am Login-Bildschirm (#1198) — Edge (#1197) und Cloud (cloud#1557).
    'lookupByEmployeeNumber',
    'stampByEmployeeNumber',
  ],
  locations: [...STANDARD_METHODS],
  // `split` (Bon-Split, #349/#350).
  orders: [...STANDARD_METHODS, 'split'],
  businessdays: BUSINESSDAYS_CLIENT_METHODS,
  // Manager-autorisierte Kassen-Eröffnung am POS.
  'cash-sessions': [...STANDARD_METHODS, 'openAuthorized'],
  'leave-requests': [...STANDARD_METHODS],
  'pre-orders': [...STANDARD_METHODS, 'convert'],
  'opening-hour-exceptions': [...STANDARD_METHODS],
} as const satisfies Record<string, readonly string[]>

export type ClientServicePath = keyof typeof CLIENT_SERVICE_METHODS
