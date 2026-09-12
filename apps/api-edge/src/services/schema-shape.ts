// Das kompilierte Schema eines registrierten Services lesen — und seine Form.
//
// Zwei Aufrufer mit derselben Frage („Welche Felder akzeptiert dieser Service
// bei create/patch, und ist das Schema geschlossen?"):
//
//   1. `assert-stamp-fields.ts` — Boot-Check + hartes Gate: Kennt das Schema die
//      Felder, die `multiTenancy()` stempelt?
//   2. `sync-conflicts/apply-resolution.ts` — Konflikt-Aufloesung „Cloud
//      uebernehmen": Welche Felder des Cloud-Records darf der Patch ueberhaupt
//      mitschicken?
//
// Getrennt gehalten von beiden, weil eine zweite Implementierung derselben
// Frage genau die Drift erzeugt, gegen die `unexcusedRequiredViolations()`
// argumentiert: Zwei Leser, die dasselbe Schema unterschiedlich lesen, fallen
// niemandem auf — beide bleiben still bzw. gruen.

import { getServiceOptions } from '@feathersjs/feathers'

import { readMarkedSchema } from '../hooks/validate-data.hook'

/** JSON-Schema-Ausschnitt, den die Formanalyse braucht. TypeBox liefert genau das. */
type JsonSchemaLike = {
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  allOf?: JsonSchemaLike[]
  anyOf?: JsonSchemaLike[]
  oneOf?: JsonSchemaLike[]
}

/** Welches Schema gemeint ist — `data` validiert `create`, `patch` validiert `patch`. */
export type SchemaKind = 'data' | 'patch'

/** Woher das Schema kam — `none` heisst: es wurde keins gefunden. */
export type SchemaSource = 'hook' | 'docs' | 'none'

export const METHOD_BY_KIND: Record<SchemaKind, 'create' | 'patch'> = { data: 'create', patch: 'patch' }

export type SchemaShape = {
  /** Alle deklarierten Property-Namen. */
  fields: Set<string>
  /** Pflichtfelder. */
  required: Set<string>
  /** `additionalProperties: false` — unbekannte Felder werden abgelehnt. */
  closed: boolean
}

/**
 * Sammelt Felder, Pflichtfelder und „ist irgendwo geschlossen?" ueber
 * Intersect-Zweige hinweg. `Type.Intersect` flacht in dieser TypeBox-Version
 * meist zu einem Objekt ab, aeltere Schemas liefern aber `allOf` — beides muss
 * der Walker abdecken.
 */
export function collectSchemaShape(schema: unknown): SchemaShape {
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
  walk(schema as JsonSchemaLike)
  return { fields, required, closed }
}

/** Feathers legt die registrierten Hooks als schlichtes `__hooks`-Objekt am Service ab. */
type ServiceWithHooks = {
  __hooks?: {
    around?: Record<string, Array<(...args: unknown[]) => unknown> | undefined>
    before?: Record<string, Array<(...args: unknown[]) => unknown> | undefined>
  }
}

/**
 * Das Schema aus dem markierten Validierungs-Hook der jeweiligen Methode.
 * Primaerquelle, weil sie an der Registrierung selbst haengt und damit jeden
 * Service erreicht — auch die sechs ohne `docs.schemas` (panary/panary-core#267).
 */
function readHookSchema(service: unknown, kind: SchemaKind): unknown {
  const before = (service as ServiceWithHooks)?.__hooks?.before?.[METHOD_BY_KIND[kind]]
  if (!Array.isArray(before)) return undefined
  for (const hook of before) {
    const schema = readMarkedSchema(hook)
    if (schema) return schema
  }
  return undefined
}

/**
 * Rueckfall: das Schema aus den Swagger-Schemas der Service-Registrierung
 * (`docs.schemas.<name>Data` / `<name>Patch`). Deckt Services ab, die den
 * Validierungs-Hook nicht ueber `hooks/validate-data.hook.ts` registrieren —
 * etwa weil ein Feathers-Update das Marker-Muster gebrochen hat.
 */
function readDocsSchema(service: unknown, kind: SchemaKind): unknown {
  const options = getServiceOptions(service as Parameters<typeof getServiceOptions>[0]) as
    { docs?: { schemas?: Record<string, unknown> } } | undefined
  const schemas = options?.docs?.schemas
  if (!schemas) return undefined
  const key = Object.keys(schemas).find(k => k.toLowerCase().endsWith(kind))
  return key ? schemas[key] : undefined
}

/**
 * Das Schema, gegen das ein externer Aufruf dieser Methode validiert wird —
 * plus die Quelle. Die Quelle ist der Grund, warum diese Funktion nicht einfach
 * das Schema zurueckgibt: „kein Schema gefunden" und „Schema ohne Felder"
 * muessen unterscheidbar bleiben, sonst liest sich Blindheit wie ein Befund.
 */
export function readServiceSchema(service: unknown, kind: SchemaKind): { schema?: unknown; source: SchemaSource } {
  const hookSchema = readHookSchema(service, kind)
  if (hookSchema) return { schema: hookSchema, source: 'hook' }
  const docsSchema = readDocsSchema(service, kind)
  if (docsSchema) return { schema: docsSchema, source: 'docs' }
  return { source: 'none' }
}

/** Die Methoden, die der Service bei `app.use()` registriert hat. */
export function readServiceMethods(service: unknown): string[] {
  const options = getServiceOptions(service as Parameters<typeof getServiceOptions>[0]) as
    { methods?: string[] } | undefined
  return options?.methods ?? []
}
