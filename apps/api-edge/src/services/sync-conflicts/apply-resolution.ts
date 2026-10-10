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
import {
  SyncConflictOrigin,
  SyncConflictResolution,
  SyncOutboxStatus,
  syncConflictOrigin,
  type SyncConflict,
  type SyncOutboxEntry,
} from '@panary/sync/domain'

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
 * Die abgelehnten Outbox-Eintraege, aus denen dieser Konflikt entstand.
 *
 * Gefiltert ueber `service`/`entityId`/`status` (Query-Whitelist der Outbox)
 * und erst danach ueber `linkedConflictId`, das dort nicht abfragbar ist. Die
 * Treffermenge je Datensatz ist klein.
 */
const linkedOutboxEntries = async (app: Application, conflict: SyncConflict): Promise<SyncOutboxEntry[]> => {
  const rows = (await app.service('sync-outbox' as any).find({
    provider: undefined,
    paginate: false,
    query: { service: conflict.service, entityId: conflict.edgeRecordId, status: SyncOutboxStatus.REJECTED },
  } as any)) as SyncOutboxEntry[]
  return rows.filter(row => row.linkedConflictId === conflict._id)
}

/**
 * „Verwerfen" (#663).
 *
 * Bis #663 rief dieser Zweig `remove(edgeRecordId)` ohne Marker auf. Am
 * Kunden-Edge (2026-10-10) stammten elf Konflikte aus abgelehnten Loesch-Ops des
 * Bootstrap-Truncates (#660); der Bootstrap hatte die Benutzer mit denselben IDs
 * neu geholt. Verwerfen loeschte zehn davon lokal und legte zehn neue `REMOVE`
 * in die Outbox — fuer den Betreiber kamen die verworfenen Loesch-Auftraege
 * „wieder".
 *
 * Jetzt:
 *  - Ursprung `remove`: kein `service.remove`. Verworfen wird der Auftrag, nicht
 *    der Datensatz.
 *  - sonst: lokal loeschen, mit `skipSyncOutbox`. Die Online-Datenbank bleibt
 *    unveraendert; das Admin-Panel sagt das vor dem Klick. Ein gepushtes REMOVE
 *    waere eine Loeschung in der Cloud, die niemand gewaehlt hat — und bei einer
 *    abgelehnten `create`-Op gaebe es dort nichts zu loeschen, das REMOVE kaeme
 *    als naechster Konflikt zurueck. `skipSyncOutbox` statt `fromSync`, weil
 *    `fromSync` zusaetzlich den Audit-Eintrag unterdrueckt
 *    (`capture-audit-before.hook.ts`); die Loeschung ist eine Operator-Aktion.
 *  - in beiden Faellen: die verknuepfte abgelehnte Outbox-Op entfernen. Sie stand
 *    sonst weiter unter „Nicht hochgeladen", obwohl ihr Konflikt erledigt ist.
 *
 * Reihenfolge: erst der Datensatz, dann die Outbox. Scheitert die Outbox, wirft
 * der Aufruf und der Konflikt bleibt offen; ein zweiter Klick ist idempotent
 * (404 beim Datensatz ist Erfolg).
 */
const discardConflict = async (app: Application, conflict: SyncConflict): Promise<void> => {
  if (syncConflictOrigin(conflict) !== SyncConflictOrigin.PUSH_REMOVE) {
    try {
      await app
        .service(conflict.service as any)
        .remove(conflict.edgeRecordId, { provider: undefined, skipSyncOutbox: true } as any)
    } catch (err) {
      // Schon weg ist das gewuenschte Ergebnis, kein Fehlschlag.
      if (!isNotFound(err)) throw err
    }
  }

  for (const entry of await linkedOutboxEntries(app, conflict)) {
    try {
      await app.service('sync-outbox' as any).remove(entry._id, { provider: undefined } as any)
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
  }
}

/**
 * Wendet die gewaehlte Aufloesung auf den Zieldatensatz an. Wirft, wenn das
 * nicht (vollstaendig) gelingt — der Aufrufer haelt den Konflikt dann offen.
 *
 * `fromSync: true` auf dem USE_CLOUD-Pfad, identisch zum regulaeren Pull-Apply
 * (`sync-apply.ts`): Der Wert kommt aus der Cloud, also darf er nicht als
 * Outbox-Eintrag dorthin zurueckgepusht werden (Sync-Echo), und `users`
 * re-hasht sonst den bereits gehashten Cloud-Passwort-Hash.
 *
 * DISCARD: siehe `discardConflict`.
 */
export const applyConflictResolution = async (app: Application, conflict: SyncConflict): Promise<void> => {
  if (conflict.resolution === SyncConflictResolution.USE_EDGE) return

  if (conflict.resolution === SyncConflictResolution.DISCARD) {
    await discardConflict(app, conflict)
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
