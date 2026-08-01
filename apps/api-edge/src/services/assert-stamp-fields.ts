// Boot-Check: Passt das DATA-Schema zu dem, was `multiTenancy()` stempelt?
//
// Der Hook laeuft in `around.all` und schreibt `data.tenantId` (und bei
// `isolateLocation` auch `data.locationId`), BEVOR `validateData` in
// `before.create` greift. Zwischen Hook und Schema gibt es zwei Widersprueche,
// die zur Bauzeit unsichtbar sind — Typecheck, Lint und Unit-Tests sind gruen,
// der Fehler entsteht erst zur Laufzeit als 400 auf einem Endpunkt:
//
//   MISSING  Das Feld fehlt in `properties` und das Schema ist geschlossen
//            (`additionalProperties: false`). AJV lehnt den gestempelten Wert
//            als `additionalProperty` ab. → Portiert aus panary-cloud
//            (`apps/api-cloud/src/services/assert-stamp-fields.ts`), wo diese
//            Klasse am 2026-07-27 drei Services gleichzeitig lahmgelegt hat.
//
//   REQUIRED Das Feld steht in `required`. Gedacht ist es als Server-Stempel —
//            der Client sendet es nie. Kann der Hook nicht stempeln (kein
//            User-Standort, kein Location-Fallback), meldet AJV
//            `must have required property '<feld>'` und zeigt damit auf den
//            Client, obwohl die Ursache serverseitig liegt. Genau dieser Fall
//            hat am 2026-08-01 `POST /apikeys` auf jedem cloud-gebootstrappten
//            Edge blockiert. Diese Regel gibt es in der Cloud nicht.
//
// MISSING ist ein sicherer Totalausfall des Endpunkts → `logger.error`.
// REQUIRED ist eine latente Falle (funktioniert, solange der Stempel greift)
// → gesammelter `logger.warn`, damit 13 betroffene Services nicht 13 Zeilen
// Rauschen erzeugen.
//
// Bewusst nur loggen, NIE werfen: liegt das Schema in einer Domain-Lib, haengt
// der Fix am Release-/Pin-Zyklus — ein Boot-Abbruch wuerde bis dahin die
// gesamte Edge-API blockieren statt nur den einen kaputten Endpunkt.

import { getServiceOptions } from '@feathersjs/feathers'
import { MULTI_TENANCY_OPTIONS, logger, type MultiTenancyOptions } from '@panary/shared-backend'

/** JSON-Schema-Ausschnitt, den der Check braucht. TypeBox liefert genau das. */
type JsonSchemaLike = {
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  allOf?: JsonSchemaLike[]
  anyOf?: JsonSchemaLike[]
  oneOf?: JsonSchemaLike[]
}

export type StampFieldViolation = {
  path: string
  /** Feld fehlt im geschlossenen Schema → jeder externe Create scheitert. */
  missing: string[]
  /** Feld ist Pflicht, obwohl der Server es stempelt → irrefuehrender 400. */
  required: string[]
  message: string
}

/**
 * Sammelt Felder, Pflichtfelder und „ist irgendwo geschlossen?" ueber
 * Intersect-Zweige hinweg. `Type.Intersect` flacht in dieser TypeBox-Version
 * meist zu einem Objekt ab, aeltere Schemas liefern aber `allOf` — beides muss
 * der Walker abdecken.
 */
function collect(schema: JsonSchemaLike): { fields: Set<string>; required: Set<string>; closed: boolean } {
  const fields = new Set<string>()
  const required = new Set<string>()
  let closed = false
  const walk = (node: JsonSchemaLike | undefined) => {
    if (!node || typeof node !== 'object') return
    for (const key of Object.keys(node.properties ?? {})) fields.add(key)
    for (const key of node.required ?? []) required.add(key)
    if (node.additionalProperties === false) closed = true
    for (const branch of [...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? [])]) walk(branch)
  }
  walk(schema)
  return { fields, required, closed }
}

/**
 * Liefert einen Befund, wenn das Data-Schema nicht zu den gestempelten Feldern
 * passt, sonst `null`. Rein lesend — der Aufrufer entscheidet ueber die Konsequenz.
 */
export function checkStampFields(params: {
  path: string
  dataSchema?: unknown
  mtOptions: MultiTenancyOptions | null
}): StampFieldViolation | null {
  const { path, dataSchema, mtOptions } = params

  // Kein multiTenancy am Service (z. B. sync-interne Pfade) → nichts gestempelt.
  if (!mtOptions) return null
  if (!dataSchema || typeof dataSchema !== 'object') return null

  const { fields, required, closed } = collect(dataSchema as JsonSchemaLike)

  const stamped = ['tenantId', ...(mtOptions.isolateLocation ? ['locationId'] : [])]

  // Ein offenes Schema akzeptiert Zusatzfelder ohnehin — MISSING kann dort nicht auftreten.
  const missing = closed ? stamped.filter(f => !fields.has(f)) : []
  const requiredStamps = stamped.filter(f => fields.has(f) && required.has(f))

  if (!missing.length && !requiredStamps.length) return null

  const parts: string[] = []
  if (missing.length) {
    parts.push(
      `multiTenancy() stempelt ${missing.join(', ')}, das DATA-Schema kennt das Feld aber nicht ` +
        `(additionalProperties: false) — jeder externe Create scheitert mit 400 "validation failed". ` +
        `Feld als Type.Optional(...) ins Data-Schema aufnehmen.`,
    )
  }
  if (requiredStamps.length) {
    parts.push(
      `${requiredStamps.join(', ')} ist im DATA-Schema Pflicht, wird aber serverseitig gestempelt — ` +
        `greift der Stempel nicht (User ohne Standort, kein Location-Fallback), meldet die API ` +
        `"must have required property" und zeigt faelschlich auf den Client. Type.Optional(...) erwaegen.`,
    )
  }

  return { path, missing, required: requiredStamps, message: `Service '${path}': ${parts.join(' | ')}` }
}

/** Feathers legt die registrierten Hooks als schlichtes `__hooks`-Objekt am Service ab. */
type ServiceWithHooks = {
  __hooks?: { around?: Record<string, Array<(...args: unknown[]) => unknown> | undefined> }
}

/**
 * Holt die `multiTenancy`-Optionen aus der `around.all`-Kette eines Services.
 * Der Hook markiert sich dafuer selbst (siehe `MULTI_TENANCY_OPTIONS`) — so
 * braucht der Check keine parallel gepflegte Service-Liste, die driften wuerde.
 */
function readMultiTenancyOptions(service: unknown): MultiTenancyOptions | null {
  const around = (service as ServiceWithHooks)?.__hooks?.around?.['all']
  if (!Array.isArray(around)) return null
  for (const hook of around) {
    const opts = (hook as unknown as Record<symbol, unknown>)?.[MULTI_TENANCY_OPTIONS]
    if (opts) return opts as MultiTenancyOptions
  }
  return null
}

/**
 * Sucht das Data-Schema in den Swagger-Schemas der Service-Registrierung.
 * Jeder Edge-Service deklariert es dort bereits (`docs.schemas.<name>Data`) —
 * der Check nutzt diese vorhandene Deklaration, statt eine eigene zu verlangen.
 */
function readDataSchema(service: unknown): unknown {
  const options = getServiceOptions(service as Parameters<typeof getServiceOptions>[0]) as
    | { docs?: { schemas?: Record<string, unknown> } }
    | undefined
  const schemas = options?.docs?.schemas
  if (!schemas) return undefined
  const key = Object.keys(schemas).find(k => k.toLowerCase().endsWith('data'))
  return key ? schemas[key] : undefined
}

/**
 * Bewusst strukturell und minimal: `Application['services']` ist die getippte
 * `ServiceTypes`-Map ohne Index-Signatur — der Sweep braucht aber nur „Objekt
 * mit Pfaden als Keys" plus den Service-Zugriff.
 */
type AppLike = {
  services: object
  service: (path: never) => unknown
}

/**
 * Boot-Sweep ueber alle registrierten Services. Gibt die Befunde zurueck
 * (fuer Tests) und loggt sie nach Schweregrad.
 */
export function assertStampFields(app: AppLike): StampFieldViolation[] {
  const violations: StampFieldViolation[] = []

  for (const path of Object.keys(app.services ?? {})) {
    const service = app.service(path as never)
    const violation = checkStampFields({
      path,
      dataSchema: readDataSchema(service),
      mtOptions: readMultiTenancyOptions(service),
    })
    if (violation) violations.push(violation)
  }

  for (const violation of violations.filter(v => v.missing.length)) {
    logger.error({
      message: violation.message,
      event: 'service.stamp_field_missing',
      path: violation.path,
      missing: violation.missing,
    })
  }

  // Aggregiert: eine Zeile fuer alle Services, sonst ertraenkt der Befund das Boot-Log.
  const requiredOnly = violations.filter(v => !v.missing.length && v.required.length)
  if (requiredOnly.length) {
    logger.warn({
      message:
        `${requiredOnly.length} Service(s) fuehren ein serverseitig gestempeltes Feld als Pflicht im ` +
        `DATA-Schema — greift der Stempel nicht, ist die 400-Meldung irrefuehrend.`,
      event: 'service.stamp_field_required',
      services: requiredOnly.map(v => `${v.path}:${v.required.join('+')}`),
    })
  }

  return violations
}
