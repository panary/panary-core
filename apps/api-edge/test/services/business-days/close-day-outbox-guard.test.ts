// Regressionstest fuer den Sync-Outbox-Guard in closeDay.
//
// Hintergrund: Die Guard-Query enthielt frueher `tenantId` — das
// syncOutboxEntryQuerySchema (additionalProperties:false, keine
// tenantId-Property, die Tabelle hat auch keine tenantId-Spalte) lehnte die
// Query ab, der stille .catch() liess pendingTotal immer auf 0 und der
// Hard-Block gegen unvollstaendige Cloud-Reports griff NIE. Dieser Test
// laeuft gegen die volle Hook-Kette (inkl. validateQuery, das den Bug
// ausgeloest hat) und verankert: pending/in-flight blockieren den
// Tagesabschluss wirklich, terminale Stati (acked/superseded) nicht.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { BadRequest } from '@feathersjs/errors'
import { BusinessDayStatus } from '@panary/businessdays/domain'
import { SyncOp, SyncOutboxStatus, SyncSource } from '@panary/sync/domain'
import { app } from '../../../src/app'

const BLOCK_MESSAGE = /Sync-Outbox enthaelt noch \d+ unsynchrone Aenderungen/

describe('business-days closeDay — Sync-Outbox-Guard', () => {
  const tenantId = uuidv7()
  const locationId = uuidv7()
  const user = { _id: uuidv7(), tenantId, locationId }

  const outboxIds: string[] = []
  let businessDayId: string

  const businessDays = () =>
    app.service('businessdays') as unknown as {
      openDay(data: { locationId: string }, params: { user: typeof user }): Promise<{ _id: string; status: string }>
      closeDay(
        data: { businessDayId: string },
        params: { user: typeof user },
      ): Promise<{ _id: string; status: string; closedBy?: string }>
      get(id: string, params: { provider: undefined }): Promise<{ status: string }>
      remove(id: string, params: { provider: undefined }): Promise<unknown>
    }

  const outbox = () => app.service('sync-outbox') as any

  const createOutboxEntry = async (status?: string): Promise<string> => {
    const entry = (await outbox().create(
      {
        _id: uuidv7(),
        service: 'orders',
        op: SyncOp.CREATE,
        entityId: uuidv7(),
        occurredAt: new Date().toISOString(),
        syncSource: SyncSource.LIVE,
      },
      { provider: undefined },
    )) as { _id: string }
    outboxIds.push(entry._id)
    // Der Data-Resolver erzwingt status=pending — abweichende Stati via Patch.
    if (status && status !== SyncOutboxStatus.PENDING) {
      await outbox().patch(entry._id, { status }, { provider: undefined })
    }
    return entry._id
  }

  // Die Test-SQLite ist prozessuebergreifend geteilt: parallel laufende
  // Testdateien erzeugen ueber den sync-outbox-Recorder eigene pending-
  // Eintraege (orders/users sind syncpflichtig). Fuer den Erfolgsfall wird
  // die Outbox daher vor dem closeDay-Versuch drainiert (pending/in-flight →
  // acked) und bei einem Race mit frisch dazugekommenen Eintraegen erneut
  // versucht. Kein anderer Test asserted auf pending-Outbox-State in der DB.
  const closeDayWithDrainedOutbox = async () => {
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      await outbox().patch(
        null,
        { status: SyncOutboxStatus.ACKED },
        {
          provider: undefined,
          query: { status: { $in: [SyncOutboxStatus.PENDING, SyncOutboxStatus.IN_FLIGHT] } },
        },
      )
      try {
        return await businessDays().closeDay({ businessDayId }, { user })
      } catch (err) {
        if (!(err instanceof BadRequest) || !BLOCK_MESSAGE.test(err.message)) throw err
        lastError = err
      }
    }
    throw lastError
  }

  beforeAll(async () => {
    await app.setup()
    const day = await businessDays().openDay({ locationId }, { user })
    businessDayId = day._id
  })

  afterAll(async () => {
    for (const id of outboxIds) {
      await outbox()
        .remove(id, { provider: undefined })
        .catch(() => undefined)
    }
    if (businessDayId) await businessDays().remove(businessDayId, { provider: undefined })
    await app.teardown()
  })

  it('blockt den Tagesabschluss bei pending Outbox-Eintraegen', async () => {
    await createOutboxEntry()

    await assert.rejects(
      () => businessDays().closeDay({ businessDayId }, { user }),
      (err: Error) => err instanceof BadRequest && BLOCK_MESSAGE.test(err.message),
      'closeDay muss bei pending Outbox-Eintraegen mit BadRequest blocken',
    )

    const stored = await businessDays().get(businessDayId, { provider: undefined })
    assert.strictEqual(stored.status, BusinessDayStatus.OPEN, 'Tag muss offen bleiben')
  })

  it('blockt den Tagesabschluss auch bei in-flight Outbox-Eintraegen', async () => {
    // pending-Eintrag aus dem vorigen Test acken, damit nur in-flight blockt
    await outbox().patch(
      null,
      { status: SyncOutboxStatus.ACKED },
      { provider: undefined, query: { status: SyncOutboxStatus.PENDING } },
    )
    await createOutboxEntry(SyncOutboxStatus.IN_FLIGHT)

    await assert.rejects(
      () => businessDays().closeDay({ businessDayId }, { user }),
      (err: Error) => err instanceof BadRequest && BLOCK_MESSAGE.test(err.message),
      'closeDay muss bei in-flight Outbox-Eintraegen mit BadRequest blocken',
    )
  })

  it('terminale Stati (acked/superseded) blockieren nicht — Tagesabschluss geht durch', async () => {
    await createOutboxEntry(SyncOutboxStatus.ACKED)
    await createOutboxEntry(SyncOutboxStatus.SUPERSEDED)

    const closed = await closeDayWithDrainedOutbox()

    assert.strictEqual(closed.status, BusinessDayStatus.CLOSING_REQUESTED)
    assert.strictEqual(closed.closedBy, user._id)

    const stored = await businessDays().get(businessDayId, { provider: undefined })
    assert.strictEqual(stored.status, BusinessDayStatus.CLOSING_REQUESTED)
  })
})
