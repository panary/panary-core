// Anwenden einer Konflikt-Aufloesung auf den Zieldatensatz.
//
// Warum ein eigenes Modul und kein Hook-Rumpf: Der Defekt aus
// panary/panary-core#293 war nicht „der Patch schlaegt fehl", sondern „der
// Fehlschlag ist unsichtbar". Ein `logger.warn` im After-Hook, den niemand
// liest, sah in der UI wie Erfolg aus — Zeile weg, Zaehler runter, Zieldatensatz
// unveraendert. Die Logik steht deshalb hier, testbar ohne App-Boot, und
// **wirft** bei jedem Fall, in dem der Cloud-Stand nicht vollstaendig angekommen
// ist. Der Aufrufer (`sync-conflicts.ts`) laesst den Konflikt dann offen.
//
// Drei Ursachen lagen uebereinander; alle drei sind hier adressiert:
//
//   1. `cloudPayload` kam als JSON-STRING zurueck. Die Spalte ist `text`
//      (20260502000002_sync_conflicts) und `sync-conflicts` registrierte keine
//      `getJsonFieldHooks` — Knex schreibt das Objekt serialisiert und liest
//      einen String. `(payload as { _id }).._id` war damit `undefined`, der
//      Patch lief als Multi-Patch mit einem String als Data und AJV meldete
//      „validation failed". Das war der Fehler, den der Sichttest am 2026-09-12
//      gesehen hat. Behoben ist er an der Registrierung (JSON-Hooks); hier
//      bleibt `coerceCloudRecord` als zweite Linie, weil Bestands-Konflikte aus
//      anderen Pfaden denselben String tragen koennen.
//
//   2. Das PATCH-Schema des Ziels ist enger als der Cloud-Record. Gemessen ueber
//      alle push-faehigen Services (`SyncableTransactionService`) trifft das
//      genau `working-times`: fuenf erlaubte Felder gegen dreizehn im Record.
//      Der volle Record laeuft dort in `additionalProperties: false`.
//      → `reduceToPatchableFields`.
//
//   3. Ein reduzierter Patch kann TEILWEISE ankommen. Genau das darf nicht
//      wieder still passieren, also wird nach dem Patch NACHGESEHEN, ob der
//      Zieldatensatz den Cloud-Stand jetzt wirklich traegt
//      (`unappliedFields`). Bleibt ein Feld zurueck, ist die Aufloesung
//      fehlgeschlagen — nicht „ueberwiegend gelungen".

/* eslint-disable @typescript-eslint/no-explicit-any -- `app.service(<string>)` ist untypisiert:
   der Zielservice steht erst zur Laufzeit im Konflikt-Record. Gleiches Muster wie `sync-apply.ts`. */
import { BadRequest } from '@feathersjs/errors'

import { USER_EDGE_LOCAL_FIELDS, stripUserEdgeLocalFields } from '@panary/users/domain'
import { SyncConflictResolution, type SyncConflict } from '@panary/sync/domain'

import type { Application } from '../../declarations'
import { collectSchemaShape, readServiceSchema, type SchemaShape } from '../schema-shape'

/**
 * Felder, die beim Anwenden BEWUSST nicht uebernommen werden — sie duerfen die
 * Nachkontrolle nicht rot faerben.
 *
 * Alle drei sind serverseitig gestempelte Audit-Felder, die kein Patch setzen
 * kann (`.claude/rules/security.md` §8). Sie zu uebernehmen waere auch fachlich
 * falsch: Geschrieben hat den Datensatz gerade dieser Edge, zu diesem
 * Zeitpunkt — nicht der Cloud-Nutzer von damals.
 *
 * `updatedBy` gehoert ausdruecklich dazu: `workingTimePatchResolver` setzt es
 * auf den aufrufenden User (beim internen Apply also `undefined`) und
 * ueberschreibt damit jeden mitgesendeten Wert. Ohne diesen Eintrag scheiterte
 * jede USE_CLOUD-Aufloesung, bei der in der Cloud jemand anderes zuletzt
 * geschrieben hat — also der Normalfall eines Concurrent-Write-Konflikts.
 */
const ALWAYS_SKIPPED_FIELDS = ['createdAt', 'updatedAt', 'updatedBy']

/**
 * Zusaetzlich uebersprungene Felder je Service.
 *
 * `users`: die geraetelokalen Time-Clock-Pointer duerfen NIEMALS ueber die
 * Edge-Cloud-Grenze wandern — sonst entsteht der Null-Clear-Deadlock aus
 * `USER_EDGE_LOCAL_FIELDS` (Pause laesst sich vom Edge aus nie mehr beenden).
 * Der regulaere Pull-Apply strippt sie aus demselben Grund
 * (`sync-apply.ts`); die Konflikt-Aufloesung ist derselbe Cloud→Edge-Weg.
 */
const SERVICE_SKIPPED_FIELDS: Record<string, readonly string[]> = {
  users: USER_EDGE_LOCAL_FIELDS,
}

/** Felder, die dieser Service beim Anwenden bewusst auslaesst. */
export const skippedFieldsFor = (service: string): string[] => [
  ...ALWAYS_SKIPPED_FIELDS,
  ...(SERVICE_SKIPPED_FIELDS[service] ?? []),
]

/**
 * Macht aus einem gespeicherten Payload wieder ein Objekt.
 *
 * `null` heisst „kein Cloud-Stand hinterlegt" (Bootstrap-Konflikte legen
 * `cloudPayload: null` an) — der Aufrufer unterscheidet das von „kaputt".
 */
export const coerceCloudRecord = (payload: unknown): Record<string, unknown> | null => {
  if (payload === null || payload === undefined || payload === '') return null
  const value = typeof payload === 'string' ? safeParse(payload) : payload
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const safeParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Reduziert den Cloud-Record auf die Felder, die das PATCH-Schema des Ziels
 * kennt. Ist das Schema offen (`additionalProperties` nicht `false`) oder gar
 * nicht lesbar, bleibt der Record unveraendert — dort kann ein Zusatzfeld nicht
 * zum 400 fuehren, und Raten waere schlechter als Durchreichen.
 */
export const reduceToPatchableFields = (
  record: Record<string, unknown>,
  shape: SchemaShape | null,
): { payload: Record<string, unknown>; dropped: string[] } => {
  if (!shape || !shape.closed) return { payload: { ...record }, dropped: [] }

  const payload: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(record)) {
    if (shape.fields.has(key)) payload[key] = value
    else dropped.push(key)
  }
  return { payload, dropped }
}

/**
 * Vergleichsnormalisierung. Zwei Eigenheiten der Edge-DB wuerden sonst als
 * „nicht angewandt" durchschlagen, obwohl der Wert korrekt gelandet ist:
 *
 *  - SQLite kennt keinen Boolean — gelesen wird `0`/`1`, die Cloud schickt
 *    `false`/`true`.
 *  - `undefined` (Feld fehlt) und `null` (Feld leer) sind fachlich dasselbe.
 *
 * Objekte/Arrays werden mit sortierten Schluesseln serialisiert, damit eine
 * abweichende Reihenfolge keinen Unterschied vortaeuscht.
 */
export const normalizeForComparison = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (input === undefined || input === null) return null
    if (typeof input === 'boolean') return input ? 1 : 0
    if (Array.isArray(input)) return input.map(normalize)
    if (typeof input === 'object') {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        out[key] = normalize((input as Record<string, unknown>)[key])
      }
      return out
    }
    return input
  }
  return JSON.stringify(normalize(value))
}

/**
 * Die Felder, die der Zieldatensatz NACH dem Anwenden immer noch anders traegt
 * als der Cloud-Stand.
 *
 * Geprueft werden nur Felder, die es lokal ueberhaupt gibt: Cloud-only-Felder
 * (`_deletedAt`, Mongo-Interna) sind kein Befund, sondern erwartete Differenz
 * zwischen den beiden Datenmodellen.
 */
export const unappliedFields = (
  cloud: Record<string, unknown>,
  local: Record<string, unknown>,
  skipped: string[],
): string[] => {
  const ignore = new Set(skipped)
  return Object.keys(cloud)
    .filter(key => !ignore.has(key))
    .filter(key => key in local)
    .filter(key => normalizeForComparison(cloud[key]) !== normalizeForComparison(local[key]))
    .sort()
}

const getOrNull = async (app: Application, service: string, id: string): Promise<Record<string, unknown> | null> => {
  try {
    return (await app.service(service as any).get(id, { provider: undefined } as any)) as Record<string, unknown>
  } catch {
    return null
  }
}

const isNotFound = (err: unknown): boolean => (err as { code?: number } | undefined)?.code === 404

/**
 * Wendet die gewaehlte Aufloesung auf den Zieldatensatz an. Wirft, wenn das
 * nicht (vollstaendig) gelingt — der Aufrufer haelt den Konflikt dann offen.
 *
 * `fromSync: true` auf dem USE_CLOUD-Pfad, identisch zum regulaeren Pull-Apply
 * (`sync-apply.ts`): Der Wert kommt aus der Cloud, also darf er nicht als
 * Outbox-Eintrag dorthin zurueckgepusht werden (Sync-Echo), und `users`
 * re-hasht sonst den bereits gehashten Cloud-Passwort-Hash.
 *
 * DISCARD laeuft bewusst OHNE `fromSync`: „Verwerfen" ist eine lokale
 * Entscheidung des Operators, kein Cloud-Applikat — die Push-Semantik dieses
 * Pfades bleibt unveraendert gegenueber dem Stand vor #293.
 */
export const applyConflictResolution = async (app: Application, conflict: SyncConflict): Promise<void> => {
  if (conflict.resolution === SyncConflictResolution.USE_EDGE) return

  if (conflict.resolution === SyncConflictResolution.DISCARD) {
    try {
      await app.service(conflict.service as any).remove(conflict.edgeRecordId, { provider: undefined } as any)
    } catch (err) {
      // Schon weg ist das gewuenschte Ergebnis, kein Fehlschlag.
      if (!isNotFound(err)) throw err
    }
    return
  }

  if (conflict.resolution !== SyncConflictResolution.USE_CLOUD) return

  const cloud = coerceCloudRecord(conflict.cloudPayload)
  if (!cloud) {
    throw new BadRequest(
      'Zu diesem Konflikt ist kein Cloud-Stand gespeichert — „Online-Version uebernehmen" ist hier nicht moeglich.',
    )
  }

  const skipped = skippedFieldsFor(conflict.service)
  const incoming = conflict.service === 'users' ? stripUserEdgeLocalFields(cloud) : cloud
  const targetId = typeof cloud._id === 'string' && cloud._id ? cloud._id : conflict.edgeRecordId

  const existing = await getOrNull(app, conflict.service, targetId)
  if (!existing) {
    // Bis #293 fiel der Apply hier auf `create(vollerRecord)` zurueck — als
    // blindes `.catch()` hinter dem Patch, nie als bewusster Pfad. Gemessen am
    // 2026-09-12 legt dieser Fallback bei `working-times` einen NEUEN Datensatz
    // an: Der Create-Resolver vergibt `_id` frisch, stempelt createdAt/updatedAt
    // und setzt `checkoutDate` zurueck. Aus „Cloud-Stand wiederherstellen" wird
    // damit „zweiter, halb leerer Eintrag" — dieselbe stille Divergenz, gegen
    // die dieses Issue laeuft, nur andersherum.
    //
    // Deshalb: ablehnen statt raten. Der Konflikt bleibt offen, „Verwerfen"
    // bleibt der Weg, ihn zu schliessen.
    throw new BadRequest(
      `Der Zieldatensatz ${targetId} existiert lokal nicht mehr — der Cloud-Stand kann nicht angewandt werden.`,
    )
  }

  const { schema } = readServiceSchema(app.service(conflict.service as any), 'patch')
  const shape = schema ? collectSchemaShape(schema) : null
  const { payload } = reduceToPatchableFields(incoming, shape)

  await app
    .service(conflict.service as any)
    .patch(targetId, payload as any, { provider: undefined, fromSync: true } as any)

  const after = await getOrNull(app, conflict.service, targetId)
  if (!after) {
    throw new BadRequest(`Der Zieldatensatz ${targetId} ist nach dem Anwenden nicht mehr lesbar.`)
  }

  const offen = unappliedFields(incoming, after, skipped)
  if (offen.length > 0) {
    throw new BadRequest(
      `Der Cloud-Stand wurde nur teilweise uebernommen — diese Felder laesst „${conflict.service}" ` +
        `per Patch nicht aendern: ${offen.join(', ')}. Der Konflikt bleibt offen.`,
    )
  }
}
