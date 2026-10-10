import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import {
  SyncConflictOrigin,
  SyncConflictReason,
  SyncConflictResolution,
  SyncConflictStatus,
  SyncOp,
  SyncOutboxStatus,
  SyncSource,
  type SyncConflict,
  type SyncOutboxEntry,
} from '@panary/sync/domain'
import type { WorkingTime } from '@panary/working-times/domain'
import { app } from '../../../src/app'

// Regressionstest fuer panary/panary-core#293 — „Online-Version uebernehmen"
// meldete Erfolg und wendete nichts an.
//
// Der Defekt hat ueberlebt, weil jeder erreichbare Test gruen war: Der aeussere
// Patch auf `sync-conflicts` lieferte 200, und niemand sah nach, ob der
// ZIELDATENSATZ danach den Cloud-Stand traegt. Diese Datei prueft ausschliesslich
// das angewandte Ergebnis — am Feld, nie am Status.
//
// Gegen die echte Test-SQLite und die volle Hook-Kette, weil zwei der drei
// Ursachen genau dort sitzen und mit einer Attrappe strukturell unsichtbar sind:
//
//   1. `cloudPayload` liegt in einer `text`-Spalte. Knex serialisiert beim
//      Schreiben, liefert beim Lesen aber einen STRING zurueck. `sync-conflicts`
//      registrierte keine `getJsonFieldHooks` — `cloudPayload._id` war damit
//      `undefined`, der Apply lief als Multi-Patch mit einem String als Data und
//      starb an AJV („validation failed"). Ein Mock haette brav das Objekt
//      zurueckgegeben, das man hineingesteckt hat.
//   2. `working-times` fuehrt ein enges, geschlossenes Patch-Schema (fuenf
//      Felder). Das wirkt erst im echten `validateData`-Hook des echten Service.
//
// `working-times` ist als Ziel nicht beliebig gewaehlt: Es ist der einzige
// push-faehige Service mit engerem PATCH- als DATA-Schema (gemessen in
// `src/services/sync-conflicts/apply-scope.spec.ts`).
describe('sync-conflicts service — Aufloesung wird tatsaechlich angewandt (#293)', () => {
  const tenantId = uuidv7()
  const locationId = uuidv7()
  const operator = { _id: uuidv7(), tenantId, locationId, role: 'tenant:owner' }
  const cloudUserId = uuidv7()

  const conflictIds: string[] = []
  const workingTimeIds: string[] = []

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    for (const id of conflictIds) {
      await app
        .service('sync-conflicts')
        .remove(id, { provider: undefined })
        .catch(() => undefined)
    }
    for (const id of workingTimeIds) {
      await app
        .service('working-times')
        .remove(id, { provider: undefined })
        .catch(() => undefined)
      for (const entry of await outboxFor(id)) {
        await app
          .service('sync-outbox')
          .remove(entry._id, { provider: undefined })
          .catch(() => undefined)
      }
    }
  })

  const outboxFor = (entityId: string) =>
    app.service('sync-outbox').find({
      provider: undefined,
      paginate: false,
      query: { entityId },
    } as never) as unknown as Promise<SyncOutboxEntry[]>

  /**
   * Legt eine echte Zeiterfassung an und stempelt sie aus. Ueber die Service-API,
   * nicht per Insert: Der Create-Resolver vergibt `_id` selbst und setzt
   * `checkoutDate` auf `null` — genau deshalb kann ein „Cloud-Record neu anlegen"
   * hier nie den Originalzustand herstellen (siehe letzter Test).
   */
  const seedWorkingTime = async (): Promise<WorkingTime> => {
    const created = (await app.service('working-times').create(
      {
        tenantId,
        locationId,
        userId: operator._id,
        businessDay: '2026-09-12',
        checkinDate: '2026-09-12T07:00:00.000Z',
      } as never,
      { provider: undefined },
    )) as WorkingTime
    workingTimeIds.push(created._id)

    return (await app
      .service('working-times')
      .patch(
        created._id,
        { checkoutDate: '2026-09-12T17:15:00.000Z', originCheckoutDate: '2026-09-12T17:15:00.000Z' } as never,
        { provider: undefined },
      )) as WorkingTime
  }

  const seedConflict = async (
    edge: WorkingTime,
    cloudPayload: unknown,
    overrides: { reason?: SyncConflictReason; edgePayload?: unknown } = {},
  ): Promise<string> => {
    const id = uuidv7()
    conflictIds.push(id)
    await app.service('sync-conflicts').create(
      {
        _id: id,
        tenantId,
        locationId,
        service: 'working-times',
        edgeRecordId: edge._id,
        cloudRecordId: edge._id,
        reason: overrides.reason ?? SyncConflictReason.PUSH_CONCURRENT_WRITE,
        edgePayload: 'edgePayload' in overrides ? overrides.edgePayload : edge,
        cloudPayload,
        status: SyncConflictStatus.OPEN,
      } as never,
      { provider: undefined },
    )
    return id
  }

  /**
   * Die abgelehnte Outbox-Op, aus der `escalateToConflict` den Konflikt macht —
   * so, wie der Push-Worker sie hinterlaesst: `rejected` mit `linkedConflictId`.
   * `remove` traegt wie im Recorder `payload: null`.
   */
  const seedRejectedOp = async (edge: WorkingTime, op: SyncOp, conflictId: string): Promise<string> => {
    const id = uuidv7()
    await app.service('sync-outbox').create(
      {
        _id: id,
        service: 'working-times',
        op,
        entityId: edge._id,
        payload: op === SyncOp.REMOVE ? null : edge,
        occurredAt: new Date().toISOString(),
        syncSource: SyncSource.LIVE,
      } as never,
      { provider: undefined },
    )
    await app
      .service('sync-outbox')
      .patch(
        id,
        {
          status: SyncOutboxStatus.REJECTED,
          terminalAt: new Date().toISOString(),
          linkedConflictId: conflictId,
        } as never,
        { provider: undefined },
      )
    return id
  }

  /**
   * Der Cloud-Stand: ausgestempelt um 18:45, geschrieben von jemand anderem.
   * VOLLSTAENDIGER Record — genau das, was `escalateToConflict` aus der
   * Cloud-Antwort speichert und was das enge Patch-Schema ablehnt.
   */
  const cloudVariant = (edge: WorkingTime, overrides: Record<string, unknown> = {}) => ({
    ...edge,
    checkoutDate: '2026-09-12T18:45:00.000Z',
    originCheckoutDate: '2026-09-12T18:45:00.000Z',
    updatedBy: cloudUserId,
    updatedAt: '2026-09-12T18:45:00.000Z',
    ...overrides,
  })

  /** Aufloesung wie aus dem Admin-Panel — mit User, damit `multiTenancy()` stempelt. */
  const resolve = (conflictId: string, resolution: SyncConflictResolution) =>
    app.service('sync-conflicts').patch(conflictId, { resolution } as never, {
      provider: undefined,
      user: operator as never,
    })

  const readConflict = (id: string) =>
    app.service('sync-conflicts').get(id, { provider: undefined }) as Promise<SyncConflict>

  it('liefert die Payloads als Objekt zurueck, nicht als JSON-String', async () => {
    // Direkt die Registrierung der `getJsonFieldHooks`. Sie ohne diesen Test zu
    // entfernen faellt nirgends auf: `coerceCloudRecord` parst den String als
    // zweite Linie, der Apply liefe weiter. Jeder ANDERE Leser bekaeme aber
    // wieder einen String — genau die Form, in der der Defekt entstanden ist,
    // und die das Admin-Panel heute mit einem `typeof === 'string'`-Zweig
    // ausgleicht.
    const edge = await seedWorkingTime()
    const conflictId = await seedConflict(edge, cloudVariant(edge))

    const stored = await readConflict(conflictId)
    assert.strictEqual(typeof stored.cloudPayload, 'object')
    assert.strictEqual(typeof stored.edgePayload, 'object')
    assert.strictEqual((stored.cloudPayload as { checkoutDate: string }).checkoutDate, '2026-09-12T18:45:00.000Z')

    // Auch aus der Liste, nicht nur aus dem Einzelabruf — `parseJsonFields`
    // haengt in `after.all` und muss beide Formen treffen.
    const rows = (await app
      .service('sync-conflicts')
      .find({ provider: undefined, paginate: false, query: { _id: conflictId } })) as SyncConflict[]
    assert.strictEqual(typeof rows[0].cloudPayload, 'object')
  })

  it('„Online-Version uebernehmen" schreibt den Cloud-Stand in den Zieldatensatz', async () => {
    const edge = await seedWorkingTime()
    const conflictId = await seedConflict(edge, cloudVariant(edge))

    await resolve(conflictId, SyncConflictResolution.USE_CLOUD)

    // Der eigentliche Befund: am FELD nachsehen, nicht am Status.
    const row = (await app.service('working-times').get(edge._id, { provider: undefined })) as WorkingTime
    assert.strictEqual(row.checkoutDate, '2026-09-12T18:45:00.000Z')
    assert.strictEqual(row.originCheckoutDate, '2026-09-12T18:45:00.000Z')
    // Nicht patchbare Felder bleiben unangetastet — der Apply weitet das
    // Patch-Schema nicht auf.
    assert.strictEqual(row.checkinDate, '2026-09-12T07:00:00.000Z')
    assert.strictEqual(row.userId, operator._id)

    const conflict = await readConflict(conflictId)
    assert.strictEqual(conflict.status, SyncConflictStatus.RESOLVED)
    assert.strictEqual(conflict.resolution, SyncConflictResolution.USE_CLOUD)
  })

  it('scheitert der Apply, bleibt der Konflikt offen statt still „resolved"', async () => {
    const edge = await seedWorkingTime()
    // Ein Feld, das `working-times` per Patch nicht aendern kann und das
    // tatsaechlich abweicht: ein TEILWEISE angewandter Cloud-Stand ist ein
    // Fehlschlag, kein „ueberwiegend gelungen".
    const conflictId = await seedConflict(edge, cloudVariant(edge, { checkinDate: '2026-09-12T06:00:00.000Z' }))

    await assert.rejects(resolve(conflictId, SyncConflictResolution.USE_CLOUD), /checkinDate/)

    const conflict = await readConflict(conflictId)
    assert.strictEqual(conflict.status, SyncConflictStatus.OPEN)
    assert.strictEqual(conflict.resolution, null)
    assert.strictEqual(conflict.resolvedAt, null)

    // Und der Teil, der patchbar gewesen waere, ist auch nicht angekommen? Doch —
    // der Patch lief. Festgehalten, damit die Meldung nicht mehr verspricht als
    // sie haelt: Der Konflikt bleibt offen, ein zweiter Versuch ist idempotent.
    const row = (await app.service('working-times').get(edge._id, { provider: undefined })) as WorkingTime
    assert.strictEqual(row.checkoutDate, '2026-09-12T18:45:00.000Z')
    assert.strictEqual(row.checkinDate, '2026-09-12T07:00:00.000Z')
  })

  it('„Diesen Standort behalten" laesst den Zieldatensatz unveraendert', async () => {
    const edge = await seedWorkingTime()
    const conflictId = await seedConflict(edge, cloudVariant(edge))

    await resolve(conflictId, SyncConflictResolution.USE_EDGE)

    const row = (await app.service('working-times').get(edge._id, { provider: undefined })) as WorkingTime
    assert.strictEqual(row.checkoutDate, '2026-09-12T17:15:00.000Z')
    assert.strictEqual((await readConflict(conflictId)).status, SyncConflictStatus.RESOLVED)
  })

  it('„Verwerfen" loescht den Edge-Record auch ohne gespeicherten Cloud-Stand', async () => {
    const edge = await seedWorkingTime()
    // Bootstrap-Konflikte legen `cloudPayload: null` an. Bis #293 sprang der
    // After-Hook dafuer im Guard heraus (`!result.cloudPayload`) — der Konflikt
    // galt als geloest, der Record blieb liegen.
    const conflictId = await seedConflict(edge, null)

    await resolve(conflictId, SyncConflictResolution.DISCARD)

    await assert.rejects(app.service('working-times').get(edge._id, { provider: undefined }))
    assert.strictEqual((await readConflict(conflictId)).status, SyncConflictStatus.RESOLVED)
  })

  it('„Online-Version uebernehmen" ohne gespeicherten Cloud-Stand scheitert sichtbar', async () => {
    const edge = await seedWorkingTime()
    const conflictId = await seedConflict(edge, null)

    await assert.rejects(resolve(conflictId, SyncConflictResolution.USE_CLOUD), /kein Cloud-Stand/)

    assert.strictEqual((await readConflict(conflictId)).status, SyncConflictStatus.OPEN)
  })

  it('legt bei fehlendem Zieldatensatz KEINEN Ersatz an, sondern lehnt ab', async () => {
    const edge = await seedWorkingTime()
    const conflictId = await seedConflict(edge, cloudVariant(edge))
    await app.service('working-times').remove(edge._id, { provider: undefined })

    await assert.rejects(resolve(conflictId, SyncConflictResolution.USE_CLOUD), /existiert lokal nicht mehr/)

    // Der alte `.catch(create)`-Fallback legte hier einen NEUEN Eintrag an:
    // `workingTimeDataResolver._id` ist `() => uuidv7()`, `checkoutDate` wird auf
    // `null` gesetzt. Aus „Cloud-Stand wiederherstellen" wurde ein zweiter, halb
    // leerer Eintrag — dieselbe stille Divergenz, nur andersherum.
    const rest = (await app
      .service('working-times')
      .find({ provider: undefined, paginate: false, query: { userId: operator._id } })) as WorkingTime[]
    assert.ok(
      !rest.some(row => row.businessDay === '2026-09-12' && row.checkinDate === edge.checkinDate && !row.checkoutDate),
      'kein neu angelegter Ersatz-Eintrag',
    )
    assert.strictEqual((await readConflict(conflictId)).status, SyncConflictStatus.OPEN)
  })

  // #663: Am Kunden-Edge stammten elf Konflikte aus abgelehnten Loesch-Ops.
  // „Verwerfen" loeschte die (neu geholten) Benutzer lokal und schrieb neue
  // REMOVE-Ops in die Outbox. Geprueft wird am Datensatz und an der Outbox,
  // nicht am Konflikt-Status.
  it('„Verwerfen" eines Konflikts aus einer Loesch-Op laesst den Datensatz stehen', async () => {
    const edge = await seedWorkingTime()
    const conflictId = await seedConflict(edge, null, {
      reason: SyncConflictReason.PUSH_REJECTED,
      edgePayload: null,
    })
    const opId = await seedRejectedOp(edge, SyncOp.REMOVE, conflictId)
    assert.strictEqual((await readConflict(conflictId)).origin, SyncConflictOrigin.PUSH_REMOVE)

    await resolve(conflictId, SyncConflictResolution.DISCARD)

    const row = (await app.service('working-times').get(edge._id, { provider: undefined })) as WorkingTime
    assert.strictEqual(row._id, edge._id)
    const outbox = await outboxFor(edge._id)
    assert.deepStrictEqual(
      outbox.filter(e => e.op === SyncOp.REMOVE).map(e => e._id),
      [],
      'weder die verworfene noch eine neue Loesch-Op in der Outbox',
    )
    assert.ok(!outbox.some(e => e._id === opId))
    assert.strictEqual((await readConflict(conflictId)).status, SyncConflictStatus.RESOLVED)
  })

  it('„Verwerfen" eines Konflikts aus einem Patch loescht nur lokal, ohne Loesch-Auftrag', async () => {
    const edge = await seedWorkingTime()
    const conflictId = await seedConflict(edge, cloudVariant(edge), { reason: SyncConflictReason.PUSH_REJECTED })
    const opId = await seedRejectedOp(edge, SyncOp.PATCH, conflictId)
    assert.strictEqual((await readConflict(conflictId)).origin, SyncConflictOrigin.PUSH_WRITE)

    await resolve(conflictId, SyncConflictResolution.DISCARD)

    await assert.rejects(app.service('working-times').get(edge._id, { provider: undefined }))
    const outbox = await outboxFor(edge._id)
    assert.deepStrictEqual(
      outbox.filter(e => e.op === SyncOp.REMOVE).map(e => e._id),
      [],
      'die Online-Datenbank erfaehrt von der lokalen Loeschung nichts',
    )
    assert.ok(!outbox.some(e => e._id === opId), 'die abgelehnte Patch-Op ist mit dem Konflikt erledigt')
  })

  it('„Verwerfen" eines Bootstrap-Konflikts loescht lokal, ohne Loesch-Auftrag', async () => {
    const edge = await seedWorkingTime()
    const conflictId = await seedConflict(edge, null, { reason: SyncConflictReason.EXTERNAL_ID_MISMATCH })
    assert.strictEqual((await readConflict(conflictId)).origin, SyncConflictOrigin.BOOTSTRAP)

    await resolve(conflictId, SyncConflictResolution.DISCARD)

    await assert.rejects(app.service('working-times').get(edge._id, { provider: undefined }))
    const outbox = await outboxFor(edge._id)
    assert.deepStrictEqual(
      outbox.filter(e => e.op === SyncOp.REMOVE).map(e => e._id),
      [],
    )
  })

  it('„Verwerfen" entfernt nur die Outbox-Op DIESES Konflikts', async () => {
    const edge = await seedWorkingTime()
    const conflictId = await seedConflict(edge, null, {
      reason: SyncConflictReason.PUSH_REJECTED,
      edgePayload: null,
    })
    const ownOp = await seedRejectedOp(edge, SyncOp.REMOVE, conflictId)
    // Abgelehnte Op desselben Datensatzes, aber zu einem anderen Konflikt.
    const otherConflictId = await seedConflict(edge, cloudVariant(edge), { reason: SyncConflictReason.PUSH_REJECTED })
    const foreignOp = await seedRejectedOp(edge, SyncOp.PATCH, otherConflictId)

    await resolve(conflictId, SyncConflictResolution.DISCARD)

    const ids = (await outboxFor(edge._id)).map(e => e._id)
    assert.ok(!ids.includes(ownOp))
    assert.ok(ids.includes(foreignOp), 'die Op des anderen Konflikts bleibt stehen')
  })

  it('„Verwerfen" bei schon geloeschtem Datensatz schliesst den Konflikt trotzdem', async () => {
    const edge = await seedWorkingTime()
    const conflictId = await seedConflict(edge, cloudVariant(edge), { reason: SyncConflictReason.PUSH_REJECTED })
    await app.service('working-times').remove(edge._id, { provider: undefined, skipSyncOutbox: true } as never)

    await resolve(conflictId, SyncConflictResolution.DISCARD)

    assert.strictEqual((await readConflict(conflictId)).status, SyncConflictStatus.RESOLVED)
  })
})
