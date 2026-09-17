// // For more information about this file see https://dove.feathersjs.com/guides/cli/service.schemas.html
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary/shared-backend'
import { randomUUID } from 'node:crypto'
import { uuidv7 } from 'uuidv7'
import { sha256 } from '../../utils/crypto.utils'

// Import domain schema
import {
  Apikey,
  apikeyDataSchema,
  apikeyPatchSchema,
  ApikeyQuery,
  apikeyQuerySchema,
  nextApikeyValidUntil,
} from '@panary/apikeys/domain'
import { UserSystemRole } from '@panary/users/domain'

//#region 1. Main Resolver (Output)
export const apikeyResolver = resolve<Apikey, HookContext>({})
export const apikeyExternalResolver = resolve<Apikey, HookContext>({
  // Apikey-Hash NIEMALS an den Client zuruecksenden!
  // Bei CREATE: Den Klartext-Key aus context.params._rawApiKey zurueckgeben (Show-Once)
  apikey: async (value: any, apiKey: any, context: HookContext): Promise<string | undefined> => {
    if (context.method === 'create') return context.params._rawApiKey
    return undefined
  },
  apikeyPrefix: async () => undefined,
  // Der pending-Hash ist Credential-Material wie `apikey` — der Klartext geht
  // ausschliesslich ueber das Socket-Event `device:key-rotated` an genau das
  // Geraet, dem er gehoert, nie ueber die Liste im Admin.
  pendingApikey: async () => undefined,
  pendingApikeyPrefix: async () => undefined,
})
//#endregion

//#region 2. Create Resolver (POST)
export const apikeyDataValidator = getValidator(apikeyDataSchema, dataValidator)
export const apikeyDataResolver = resolve<Apikey, HookContext>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },
  apikey: async (value: any, data: any, context: HookContext): Promise<string> => {
    // Show-Once-Then-Hash: Klartext-Key generieren, Hash speichern
    // Interner Aufrufer (z.B. devices.ts) kann den Raw-Key via params._rawApiKey vorgeben
    const rawKey = context.params._rawApiKey || randomUUID()
    context.params._rawApiKey = rawKey
    return sha256(rawKey)
  },
  apikeyPrefix: async (value: any, data: any, context: HookContext): Promise<string> => {
    return (context.params._rawApiKey || '').slice(0, 8)
  },
  active: async (): Promise<boolean> => true,
  // Geraete-Schluessel sind ab Ausstellung befristet (ADR 0042). Die Vorgabe
  // sitzt hier und nicht im Pairing-Hook, damit JEDER Weg, auf dem ein
  // Geraete-Schluessel entsteht (Pairing, Pairing-Code, Seed), sie bekommt.
  // Ohne `deviceId` ist es ein Integrations-Schluessel ohne Rotationspfad —
  // dort bleibt es beim manuell gesetzten Wert bzw. unbefristet.
  validUntil: async (value: any, data: any): Promise<string | undefined> => {
    if (value) return value
    return data?.deviceId ? nextApikeyValidUntil(Date.now()) : undefined
  },
  createdAt: async (): Promise<string> => new Date().toISOString(),
  updatedAt: async (): Promise<string> => new Date().toISOString(),
  createdBy: async (value: any, user: any, context: HookContext) => context.params?.user?._id || 'system',
  role: async (value, data, context) => {
    if (value) return value

    if (data.deviceId) {
      try {
        const device = await context.app.service('devices').get(data.deviceId)
        const type = device.type || 'other'
        switch (type) {
          case 'kds':
            return UserSystemRole.DEVICE_KDS
          case 'tablet':
            return UserSystemRole.DEVICE_TABLET
          case 'pos-counter':
            return UserSystemRole.DEVICE_POS
          default:
            return UserSystemRole.DEVICE_POS
        }
      } catch (error) {
        // Device not found or error
      }
    }
    return UserSystemRole.DEVICE_POS
  },
})
//#endregion

//#region 3. Patch Resolver (PATCH)
export const apikeyPatchValidator = getValidator(apikeyPatchSchema, dataValidator)

/**
 * Feld-Weiche fuer die stille Schluessel-Rotation (ADR 0042).
 *
 * Bewusst ENGER als die `provider`-Weiche bei `lastUsedAt`: Nicht „jeder
 * interne Aufrufer", sondern „der Rotations-Pfad". Hier geht es um
 * Credential-Material — `apikey` zu ueberschreiben heisst, ein Geraet
 * auszutauschen. Der Marker `_apikeyRotation` wird ausschliesslich in
 * `utils/device-apikey-auth.ts` gesetzt; das Muster (Steuerung ueber
 * `context.params._*`) folgt `_rawApiKey` weiter oben in dieser Datei.
 *
 * Extern bleibt jedes dieser Felder unveraenderlich — daran aendert die
 * Rotation nichts.
 */
const rotationOnly = <T>(value: T, _data: unknown, context: HookContext): T | undefined =>
  context.params.provider === undefined && (context.params as { _apikeyRotation?: boolean })._apikeyRotation === true
    ? value
    : undefined

export const apikeyPatchResolver = resolve<Apikey, HookContext>({
  // API-Keys sind nach Erstellung unveränderlich — extern darf nur der
  // active-Status getoggelt werden. Alle anderen Felder werden beim PATCH
  // verworfen (Privilege Escalation verhindern).
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  name: async () => undefined,
  description: async () => undefined,
  role: async () => undefined,
  deviceId: async () => undefined,
  createdBy: async () => undefined,
  // Rotations-Felder: nur ueber den Rotations-Pfad, nie von aussen.
  apikey: rotationOnly,
  apikeyPrefix: rotationOnly,
  pendingApikey: rotationOnly,
  pendingApikeyPrefix: rotationOnly,
  pendingApikeyCreatedAt: rotationOnly,
  // `validUntil` ist kein Sperrmittel und gehoert der Automatik: Ein manuell
  // verkuerztes Datum wuerde beim naechsten Handshake ohnehin rotiert und
  // verlaengert. Wer einen Schluessel stilllegen will, setzt `active: false`.
  validUntil: rotationOnly,
  // Nutzungs-Telemetrie: ausschliesslich serverseitig stempelbar. Externe
  // Aufrufer (Admin-UI, POS) koennen das Feld nicht setzen — sonst liesse sich
  // eine Key-Nutzung vortaeuschen oder verschleiern (Revocation-Hygiene).
  // Interne Aufrufer (`provider: undefined`) sind die beiden Auth-Pfade:
  // WS-Handshake (channels.ts) und Print-Server-Middleware, jeweils ueber
  // `stampApiKeyLastUsed` in utils/apikey-last-used.ts.
  lastUsedAt: async (value, _data, context) => (context.params.provider ? undefined : value),
  active: async value => value,
  createdAt: async () => undefined,
  updatedAt: async (): Promise<string> => new Date().toISOString(),
})
//#endregion

//#region 4. Query Resolver (GET)
export const apikeyQueryValidator = getValidator(apikeyQuerySchema, queryValidator)
export const apikeyQueryResolver = resolve<ApikeyQuery, HookContext>({})
//#endregion
