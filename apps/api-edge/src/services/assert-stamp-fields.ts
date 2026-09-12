// Boot-Check: Passen DATA- und PATCH-Schema zu dem, was `multiTenancy()` stempelt?
//
// Der Hook laeuft in `around.all` und schreibt `data.tenantId` (und bei
// `isolateLocation` auch `data.locationId`), BEVOR `validateData` in
// `before.create` bzw. `before.patch` greift. Zwischen Hook und Schema gibt es
// zwei Widersprueche, die zur Bauzeit unsichtbar sind — Typecheck, Lint und
// Unit-Tests sind gruen, der Fehler entsteht erst zur Laufzeit als 400 auf
// einem Endpunkt:
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
//            Edge blockiert. Diese Regel gibt es in der Cloud nicht — und sie
//            gilt NUR fuer das DATA-Schema: In einem Patch-Schema ist fast
//            alles optional, ein Pflichtfeld dort ist ein anderer Fall und
//            wuerde nur falsch alarmieren.
//
// MISSING ist ein sicherer Totalausfall des Endpunkts → `logger.error`.
// REQUIRED ist eine latente Falle (funktioniert, solange der Stempel greift)
// → gesammelter `logger.warn`, damit 13 betroffene Services nicht 13 Zeilen
// Rauschen erzeugen.
//
// BEIDE Regeln sind seit panary/panary-core#289 auch im harten Gate
// (`stamp-fields-invariant.spec.ts`), REQUIRED mit `REQUIRED_STAMP_EXCEPTIONS`
// als Ausnahmeliste. Ausschlaggebend war nicht die Schaerfe, sondern die
// GEGENRICHTUNG: Die Liste hatte keine Obsoleszenz-Pruefung. Wird ein Schema
// spaeter `Type.Optional`, bleibt der Eintrag still stehen — also genau die
// Verrottung, gegen die es die Liste ueberhaupt gibt. Das Gate prueft beide
// Richtungen und nutzt dafuer `unexcusedRequiredViolations()` statt eines
// zweiten, driftenden Filters.
//
// ABDECKUNG (panary/panary-core#267). Der Check hatte zwei gemessene blinde
// Flecken, beide aus derselben Ursache — er kam nur ueber `docs.schemas` und
// nur an das DATA-Schema:
//
//   1. `patch` ist fuer `multiTenancy()` genauso WRITE wie `create`. Die
//      PATCH-Seite blieb ungeprueft, obwohl die Klasse dort bereits dreimal
//      zuschlug: #174 (Notifications), #183 (sync-conflicts),
//      panary/panary-cloud#200 (fiscal-counters, reservations).
//   2. `docs.schemas` ist freiwillig. Sechs Services deklarieren keine und
//      waren damit unsichtbar — darunter `sync-conflicts` und
//      `fiscal-counters`, also genau die beiden zuletzt betroffenen.
//
// `sync-conflicts` lag in beiden Flecken gleichzeitig: Am 2026-09-12 antwortete
// „Verwerfen" auf einen offenen Sync-Konflikt mit „Mandant: must NOT have
// additional properties" — ein Fall, den dieser Check nie haette melden
// koennen. Das Schema kommt deshalb jetzt aus dem markierten
// Validierungs-Hook (`hooks/validate-data.hook.ts`), `docs.schemas` ist nur
// noch Rueckfall.
//
// Bewusst nur loggen, NIE werfen: liegt das Schema in einer Domain-Lib, haengt
// der Fix am Release-/Pin-Zyklus — ein Boot-Abbruch wuerde bis dahin die
// gesamte Edge-API blockieren statt nur den einen kaputten Endpunkt. Das harte
// Gate ist `stamp-fields-invariant.spec.ts`, nicht dieser Boot-Check: Ein
// Verstoss, der es an der CI vorbei nach Produktion schafft, bleibt hier ein
// stiller `logger.error` in einem Boot-Log, das niemand liest.

import { getServiceOptions } from '@feathersjs/feathers'
import { MULTI_TENANCY_OPTIONS, logger, type MultiTenancyOptions } from '@panary/shared-backend'

import { readMarkedSchema } from '../hooks/validate-data.hook'

/** JSON-Schema-Ausschnitt, den der Check braucht. TypeBox liefert genau das. */
type JsonSchemaLike = {
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  allOf?: JsonSchemaLike[]
  anyOf?: JsonSchemaLike[]
  oneOf?: JsonSchemaLike[]
}

/**
 * Services, deren DATA-Schema ein gestempeltes Feld BEWUSST als Pflicht fuehrt.
 * Ohne diese Liste meldete der Check dieselben bekannten Faelle bei jedem Boot
 * und die Warnung waere nach der dritten Woche unsichtbar.
 *
 * Betrifft ausschliesslich die REQUIRED-Regel und damit ausschliesslich das
 * DATA-Schema — die PATCH-Seite kennt diese Regel nicht.
 *
 * Jeder Eintrag braucht eine Begruendung — „schon immer so" zaehlt nicht.
 * Wer einen Service hier eintraegt, entscheidet sich fuer eine potenziell
 * irrefuehrende 400-Meldung; das muss die Alternative aufwiegen.
 */
export const REQUIRED_STAMP_EXCEPTIONS: Record<string, string> = {
  // SQLite hat auf BEIDEN Spalten `notNullable` (20260328000004_pre_orders).
  // Optional zu machen verwandelt einen klaren 400 in einen
  // `NOT NULL constraint failed`-500 — eine Verschlechterung.
  'pre-orders': 'DB-Constraint notNullable auf tenantId und locationId',
  // `locations.tenantId` ist ebenfalls notNullable (20260219000002). Zusaetzlich
  // ist der einzige externe Create-Pfad der Sync-Pull-Apply, der OHNE `user`
  // laeuft — dort ist `required` die einzige Instanz, die einen defekten
  // Cloud-Record laut ablehnt statt ihn still mit NULL zu schreiben.
  locations: 'DB-Constraint notNullable auf tenantId + Pull-Apply ohne user',
  // Diese Services sind Ziel des Cloud→Edge-Pull-Apply (`sync-apply.ts`,
  // `create(..., { provider: undefined, fromSync: true })` — also ohne `user`,
  // damit ohne Stempel). Faellt `required` weg, landet ein Cloud-Record ohne
  // locationId still mit NULL in der Edge-DB und ist fuer den filial-gescopten
  // POS unsichtbar: „gesynct, aber nicht da" ohne jede Fehlermeldung. Der laute
  // REJECTED-Eintrag im sync-runs-Detail ist die bessere Diagnose.
  // Lockerung erst zusammen mit einem Guard, der im fromSync-Pfad ein fehlendes
  // tenantId/locationId hart ablehnt.
  //
  // `products`/`product-groups` fuehren `locationId` seit #190 als
  // `Type.Union([String, Null])` — ein EXPLIZITES `null` ist dort jetzt ein
  // gueltiger Wert („tenant-weit", sichtbar dank `allowGlobalData: true`) und
  // nicht mehr der oben beschriebene Unfall. Die Begruendung fuer `required`
  // bleibt davon unberuehrt: Sie zielt auf das FEHLENDE Feld, das AJV weiterhin
  // ablehnt. Fuer die uebrigen Eintraege der Liste ist NULL nach wie vor der
  // Unsichtbarkeits-Fall — deren Services laufen ohne `allowGlobalData`.
  products: 'Pull-Apply ohne user — required ist der einzige Schutz',
  'product-groups': 'Pull-Apply ohne user — required ist der einzige Schutz',
  customers: 'Pull-Apply ohne user — required ist der einzige Schutz',
  'corporate-customers': 'Pull-Apply ohne user — required ist der einzige Schutz',
  'opening-hour-exceptions': 'Pull-Apply ohne user — required ist der einzige Schutz',
  discounts: 'Pull-Apply ohne user — required ist der einzige Schutz',

  // ─── Mit panary/panary-core#267 erstmals sichtbar, geklaert in #289 ──────────
  //
  // Keiner der folgenden fuenf deklariert `docs.schemas`; der alte Check kam
  // gar nicht an ihr Schema. Die Warnzeile ist also neu, ihr Inhalt ist alt —
  // `tenantId` steht dort seit der jeweils ersten Migration als Pflicht.
  //
  // Geprueft wurde je Service die EINE Frage, auf die die REQUIRED-Regel zielt:
  // Kann ein EXTERNER Create bis `validateData` kommen und dort die
  // irrefuehrende Meldung „must have required property 'tenantId'" ausloesen?
  // Bei allen fuenf lautet die Antwort nein, und zwar aus einem Grund, der im
  // Code steht und nicht aus Gewohnheit — deshalb Ausnahme statt
  // `Type.Optional`. Gemeinsam ist ihnen ausserdem: geschrieben wird nur
  // intern und ohne `user`, wo `multiTenancy()` im Early-Return aussteigt
  // (`if (!user) return next()`) und gar nicht stempelt. `required` ist dort
  // nicht der Konstruktionsfehler, sondern die einzige Stelle, die einen
  // internen Schreiber bemerkt, der das Feld vergisst.

  // `blockExternalWrites` ist der AEUSSERSTE around-Hook (sync-runs.ts) und
  // wirft `Forbidden` fuer jeden `create` mit `provider` — extern erreicht
  // niemand die Validierung. Intern legt nur `recordSyncRun` an, mit eigener
  // tenantId; die Spalte ist notNullable (20260507000001_sync_runs).
  'sync-runs': 'blockExternalWrites wirft Forbidden vor validateData; Spalte notNullable (20260507000001)',
  // Gleiche Sperre fuer create/patch/update (audit-events.ts) — hier zusaetzlich
  // als Manipulationsschutz gedacht. Schreiber sind die Audit-Hooks und
  // `cloud-realtime.worker.ts`, alle mit explizitem tenantId; Spalte notNullable
  // (20260506000001_audit_events).
  'audit-events': 'blockExternalWrites wirft Forbidden vor validateData; Spalte notNullable (20260506000001)',
  // Gleiche Sperre (bootstrap-reports.ts). Sonderfall gegenueber den anderen
  // vier: Die Spalte ist NULLABLE (20260507100001_bootstrap_reports) und das
  // Schema fuehrt `tenantId` als `Type.Union([String, Null])` — ein explizites
  // `null` ist ein gueltiger Wert („noch nicht gepairt"). Genau deshalb waere
  // `Type.Optional` hier die schlechtere Wahl: `required` ist das, was
  // `createReport` zwingt, dieses `null` AUSZUSPRECHEN (bootstrap-report.helper.ts),
  // statt das Feld wegzulassen und still NULL zu schreiben. Das 500-Argument der
  // notNullable-Eintraege traegt hier nicht — dieses tut es.
  'bootstrap-reports': 'blockExternalWrites + nullable by design: required erzwingt das explizite tenantId: null',
  // Keine `blockExternalWrites`, aber auch kein externer Create: Die
  // Rollenmatrix kennt fuer `fiscal-counters` ausschliesslich READ
  // (roles.matrix.ts), `authorize()` liefert externen Aufrufern 403. Vergeben
  // wird der Zaehler intern in `allocateFiscalCounter` mit explizitem tenantId;
  // Spalte notNullable (20260527140000_fiscal_counters).
  'fiscal-counters': 'authorize() 403 mangels MANAGE in der Rollenmatrix; Spalte notNullable (20260527140000)',
  // Der einzige der fuenf, den ein externer Create erreichen KANN
  // (SYNC_CONFLICTS: MANAGE fuer OWNER/TECHNICIAN/MANAGER). Der gemeldete
  // Fehlerfall tritt trotzdem nicht ein: Fuer einen Tenant-User stempelt
  // `multiTenancy()` `tenantId` unbedingt (multi-tenancy.hook.ts, `item.tenantId
  // = user.tenantId`) — die Meldung kann nur einen User ohne tenantId treffen,
  // den es am Edge nicht gibt. Angelegt werden Konflikte ohnehin nur von den
  // Sync-Workern; Spalte notNullable (20260502000002_sync_conflicts).
  'sync-conflicts': 'Stempel greift fuer jeden Tenant-User unbedingt; Spalte notNullable (20260502000002)',
}

/**
 * Welches Schema geprueft wurde. `multiTenancy()` stempelt bei `create` UND bei
 * `patch` (`['create', 'update', 'patch'].includes(context.method)` in
 * multi-tenancy.hook.ts), also muessen beide Schemas die Felder kennen.
 */
export type StampFieldKind = 'data' | 'patch'

export type StampFieldViolation = {
  path: string
  kind: StampFieldKind
  /** Feld fehlt im geschlossenen Schema → jeder externe Create/Patch scheitert. */
  missing: string[]
  /** Feld ist Pflicht, obwohl der Server es stempelt → irrefuehrender 400. Nur `data`. */
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
 * Liefert einen Befund, wenn das gepruefte Schema nicht zu den gestempelten
 * Feldern passt, sonst `null`. Rein lesend — der Aufrufer entscheidet ueber die
 * Konsequenz und ruft je Service einmal mit `kind: 'data'` und einmal mit
 * `kind: 'patch'` auf.
 */
export function checkStampFields(params: {
  path: string
  dataSchema?: unknown
  mtOptions: MultiTenancyOptions | null
  /** Welches Schema in `dataSchema` steckt. Default `data` (Bestandsaufrufer). */
  kind?: StampFieldKind
}): StampFieldViolation | null {
  const { path, dataSchema, mtOptions, kind = 'data' } = params

  // Kein multiTenancy am Service (z. B. sync-interne Pfade) → nichts gestempelt.
  if (!mtOptions) return null
  if (!dataSchema || typeof dataSchema !== 'object') return null

  const { fields, required, closed } = collect(dataSchema as JsonSchemaLike)

  const stamped = ['tenantId', ...(mtOptions.isolateLocation ? ['locationId'] : [])]

  // Ein offenes Schema akzeptiert Zusatzfelder ohnehin — MISSING kann dort nicht auftreten.
  const missing = closed ? stamped.filter(f => !fields.has(f)) : []
  // REQUIRED gilt nur fuer DATA: Patch-Schemas fuehren praktisch nichts als
  // Pflicht, ein Pflichtfeld dort ist ein anderer Fall (und war beim ersten
  // Lauf in der Cloud die Quelle von 13 Falschmeldungen).
  const requiredStamps = kind === 'data' ? stamped.filter(f => fields.has(f) && required.has(f)) : []

  if (!missing.length && !requiredStamps.length) return null

  const label = kind === 'patch' ? 'PATCH' : 'DATA'
  const methode = kind === 'patch' ? 'Patch' : 'Create'
  const parts: string[] = []
  if (missing.length) {
    parts.push(
      `multiTenancy() stempelt ${missing.join(', ')}, das ${label}-Schema kennt das Feld aber nicht ` +
        `(additionalProperties: false) — jeder externe ${methode} scheitert mit 400 "validation failed". ` +
        `Feld als Type.Optional(...) ins ${label}-Schema aufnehmen.`,
    )
  }
  if (requiredStamps.length) {
    parts.push(
      `${requiredStamps.join(', ')} ist im ${label}-Schema Pflicht, wird aber serverseitig gestempelt — ` +
        `greift der Stempel nicht (User ohne Standort, kein Location-Fallback), meldet die API ` +
        `"must have required property" und zeigt faelschlich auf den Client. Type.Optional(...) erwaegen.`,
    )
  }

  return { path, kind, missing, required: requiredStamps, message: `Service '${path}': ${parts.join(' | ')}` }
}

/** Feathers legt die registrierten Hooks als schlichtes `__hooks`-Objekt am Service ab. */
type ServiceWithHooks = {
  __hooks?: {
    around?: Record<string, Array<(...args: unknown[]) => unknown> | undefined>
    before?: Record<string, Array<(...args: unknown[]) => unknown> | undefined>
  }
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

/** Woher das gepruefte Schema kam — `none` heisst: es wurde nichts geprueft. */
export type StampSchemaSource = 'hook' | 'docs' | 'none'

const METHOD_BY_KIND: Record<StampFieldKind, 'create' | 'patch'> = { data: 'create', patch: 'patch' }

/**
 * Das Schema aus dem markierten Validierungs-Hook der jeweiligen Methode.
 * Primaerquelle, weil sie an der Registrierung selbst haengt und damit jeden
 * Service erreicht — auch die sechs ohne `docs.schemas` (#267).
 */
function readHookSchema(service: unknown, kind: StampFieldKind): unknown {
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
function readDocsSchema(service: unknown, kind: StampFieldKind): unknown {
  const options = getServiceOptions(service as Parameters<typeof getServiceOptions>[0]) as
    { docs?: { schemas?: Record<string, unknown> } } | undefined
  const schemas = options?.docs?.schemas
  if (!schemas) return undefined
  const key = Object.keys(schemas).find(k => k.toLowerCase().endsWith(kind))
  return key ? schemas[key] : undefined
}

/** Die Methoden, die der Service bei `app.use()` registriert hat. */
function readServiceMethods(service: unknown): string[] {
  const options = getServiceOptions(service as Parameters<typeof getServiceOptions>[0]) as
    { methods?: string[] } | undefined
  return options?.methods ?? []
}

/**
 * Ein Pruefziel: Service × Schema-Art, mit der Quelle des Schemas. Die Quelle
 * ist der Grund, warum es diesen Typ ueberhaupt gibt: Ein leeres Befund-Ergebnis
 * beweist ohne sie nur, dass nichts gefunden wurde — nicht, dass gesucht wurde.
 * `stamp-fields-invariant.spec.ts` prueft beides getrennt.
 */
export type StampCheckTarget = {
  path: string
  kind: StampFieldKind
  /** Methode, deren Payload gegen dieses Schema validiert wird. */
  method: 'create' | 'patch'
  /** Bietet der Service diese Methode ueberhaupt an? */
  methodRegistered: boolean
  source: StampSchemaSource
  schema?: unknown
  mtOptions: MultiTenancyOptions | null
}

/**
 * Sammelt alle Pruefziele der App — ohne zu bewerten. Exportiert, damit das
 * harte Gate dieselbe Quelle nutzt wie der Boot-Check und nicht eine zweite,
 * driftende Registrierung nachbaut.
 */
export function collectStampTargets(app: AppLike): StampCheckTarget[] {
  const targets: StampCheckTarget[] = []

  for (const path of Object.keys(app.services ?? {})) {
    const service = app.service(path as never)
    const mtOptions = readMultiTenancyOptions(service)
    const methods = readServiceMethods(service)

    for (const kind of ['data', 'patch'] as const) {
      const hookSchema = readHookSchema(service, kind)
      const schema = hookSchema ?? readDocsSchema(service, kind)
      targets.push({
        path,
        kind,
        method: METHOD_BY_KIND[kind],
        methodRegistered: methods.includes(METHOD_BY_KIND[kind]),
        source: hookSchema ? 'hook' : schema ? 'docs' : 'none',
        schema,
        mtOptions,
      })
    }
  }

  return targets
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
 * Die REQUIRED-Befunde, die noch KEINE begruendete Ausnahme haben.
 *
 * Eine exportierte Funktion statt zweier Filter-Ausdruecke, aus demselben Grund,
 * aus dem `collectStampTargets` exportiert ist: Boot-Check und hartes Gate
 * sollen dieselbe Frage stellen. Zwei handgeschriebene Filter waeren zwei
 * Gelegenheiten, auseinanderzulaufen — und die Abweichung faellt niemandem auf,
 * weil beide Seiten weiterhin gruen bzw. still sind.
 */
export function unexcusedRequiredViolations(violations: StampFieldViolation[]): StampFieldViolation[] {
  return violations.filter(v => v.required.length > 0 && !REQUIRED_STAMP_EXCEPTIONS[v.path])
}

/**
 * Boot-Sweep ueber alle registrierten Services. Gibt die Befunde zurueck
 * (fuer Tests) und loggt sie nach Schweregrad.
 */
export function assertStampFields(app: AppLike): StampFieldViolation[] {
  const violations = collectStampTargets(app)
    .map(target =>
      checkStampFields({
        path: target.path,
        dataSchema: target.schema,
        mtOptions: target.mtOptions,
        kind: target.kind,
      }),
    )
    .filter((v): v is StampFieldViolation => v !== null)

  for (const violation of violations.filter(v => v.missing.length)) {
    logger.error({
      message: violation.message,
      event: 'service.stamp_field_missing',
      path: violation.path,
      kind: violation.kind,
      missing: violation.missing,
    })
  }

  // Aggregiert: eine Zeile fuer alle Services, sonst ertraenkt der Befund das Boot-Log.
  // `!v.missing.length` nur hier: Ein Service mit BEIDEN Befunden soll nicht
  // zweimal im Boot-Log stehen — der `logger.error` oben ist der lautere.
  const requiredOnly = unexcusedRequiredViolations(violations).filter(v => !v.missing.length)
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
