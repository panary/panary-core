// Regressionstest fuer den Sync-Outbox-Guard in closeDay.
//
// Hintergrund (zwei Runden): (1) Die Guard-Query enthielt frueher `tenantId` —
// das syncOutboxEntryQuerySchema (additionalProperties:false, keine
// tenantId-Property) lehnte die Query ab, der stille .catch() liess
// pendingTotal immer auf 0 und der Hard-Block griff NIE. (2) Der reaktivierte
// Guard blockte danach AUCH im Standalone-Modus (dort laeuft nie ein Push,
// pending akkumuliert fuer immer) und beim Emergency-Override (Cloud-Outage
// ⇒ pending garantiert) — Review-Befund 2026-07-06. Der Guard ist deshalb an
// den Cloud-Modus gebunden.
//
// Test-Aufbau BEWUSST ohne geseedete CONNECTED-cloud-connection: die
// Test-SQLite ist prozessuebergreifend geteilt, und eine CONNECTED-Connection
// kippt parallele Suiten (restrict-order-to-business-day, cloud-managed) in
// den Cloud-Modus. Die Modi-Matrix (skip/warn/block) wird deshalb ueber die
// reine Funktion evaluateOutboxGuard verankert, die Query-Verkabelung (Bug 1)
// direkt gegen die volle sync-outbox-Hook-Kette, und Standalone end-to-end.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { BadRequest } from '@feathersjs/errors'
import { BusinessDayStatus } from '@panary/businessdays/domain'
import { SyncOp, SyncOutboxStatus, SyncSource } from '@panary/sync/domain'
import { app } from '../../../src/app'
import { evaluateOutboxGuard } from '../../../src/services/business-days/business-days'

describe('business-days closeDay — Sync-Outbox-Guard', () => {
  const tenantId = uuidv7()
  const locationId = uuidv7()
  const user = { _id: uuidv7(), tenantId, locationId }

  const outboxIds: string[] = []
  const businessDayIds: string[] = []

  const businessDays = () =>
    app.service('businessdays') as unknown as {
      openDay(data: { locationId: string }, params: { user: typeof user }): Promise<{ _id: string; status: string }>
      closeDay(
        data: { businessDayId: string },
        params: { user: typeof user; isEmergencyOverride?: boolean },
      ): Promise<{ _id: string; status: string; closedBy?: string }>
      get(id: string, params: { provider: undefined }): Promise<{ status: string }>
      remove(id: string, params: { provider: undefined }): Promise<unknown>
    }

  const outbox = () => app.service('sync-outbox') as any

  const createOutboxEntry = async (status?: string): Promise<{ id: string; entityId: string }> => {
    const entityId = uuidv7()
    const entry = (await outbox().create(
      {
        _id: uuidv7(),
        service: 'orders',
        op: SyncOp.CREATE,
        entityId,
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
    return { id: entry._id, entityId }
  }

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    for (const id of outboxIds) {
      await outbox()
        .remove(id, { provider: undefined })
        .catch(() => undefined)
    }
    for (const id of businessDayIds) {
      await businessDays()
        .remove(id, { provider: undefined })
        .catch(() => undefined)
    }
    await app.teardown()
  })

  describe('Modi-Matrix (evaluateOutboxGuard, rein)', () => {
    it('Standalone prueft nie — auch bei pending', () => {
      assert.strictEqual(
        evaluateOutboxGuard({ cloudConnected: false, pendingTotal: 42, isEmergencyOverride: false }),
        'skip',
      )
      assert.strictEqual(
        evaluateOutboxGuard({ cloudConnected: false, pendingTotal: 42, isEmergencyOverride: true }),
        'skip',
      )
    })

    it('CONNECTED ohne pending laesst durch', () => {
      assert.strictEqual(
        evaluateOutboxGuard({ cloudConnected: true, pendingTotal: 0, isEmergencyOverride: false }),
        'skip',
      )
    })

    it('CONNECTED mit pending blockt hart', () => {
      assert.strictEqual(
        evaluateOutboxGuard({ cloudConnected: true, pendingTotal: 1, isEmergencyOverride: false }),
        'block',
      )
    })

    it('Emergency-Override degradiert den Block zur Warnung', () => {
      assert.strictEqual(
        evaluateOutboxGuard({ cloudConnected: true, pendingTotal: 7, isEmergencyOverride: true }),
        'warn',
      )
    })
  })

  describe('Guard-Query gegen die volle sync-outbox-Hook-Kette (Bug-1-Regression)', () => {
    it('pending/in-flight-Zaehlung passiert validateQuery und zaehlt korrekt', async () => {
      const { id, entityId } = await createOutboxEntry()

      // Exakt die Feld-Formen der Guard-Query (status-$in) + entityId zur
      // Isolation gegen parallel erzeugte Outbox-Eintraege anderer Suiten.
      const guardQuery = {
        entityId,
        status: { $in: [SyncOutboxStatus.PENDING, SyncOutboxStatus.IN_FLIGHT] },
        $limit: 0,
      }
      const pending = await outbox().find({ query: guardQuery, provider: undefined })
      assert.strictEqual(pending.total, 1, 'pending-Eintrag muss gezaehlt werden')

      await outbox().patch(id, { status: SyncOutboxStatus.IN_FLIGHT }, { provider: undefined })
      const inFlight = await outbox().find({ query: guardQuery, provider: undefined })
      assert.strictEqual(inFlight.total, 1, 'in-flight-Eintrag muss gezaehlt werden')

      await outbox().patch(id, { status: SyncOutboxStatus.ACKED }, { provider: undefined })
      const acked = await outbox().find({ query: guardQuery, provider: undefined })
      assert.strictEqual(acked.total, 0, 'acked darf nicht mehr zaehlen')
    })

    it('tenantId in der Query wird weiterhin abgelehnt — der Ursprungs-Bug bleibt verankert', async () => {
      // Bug 1: die Guard-Query enthielt tenantId, validateQuery lehnte ab und
      // der stille .catch() deaktivierte den Guard. Dieser Negativ-Anker
      // stellt sicher, dass niemand tenantId wieder in die Query aufnimmt
      // und sich auf "wird schon gefiltert" verlaesst.
      await assert.rejects(
        () =>
          outbox().find({
            query: { tenantId: uuidv7(), status: SyncOutboxStatus.PENDING, $limit: 0 },
            provider: undefined,
          }),
        (err: Error) => err instanceof BadRequest,
        'tenantId muss vom sync-outbox-Query-Schema abgelehnt werden',
      )
    })
  })

  describe('closeDay end-to-end (Standalone — keine CONNECTED-Connection in der Test-DB)', () => {
    it('schliesst trotz pending Outbox-Eintraegen (Guard uebersprungen)', async () => {
      const day = await businessDays().openDay({ locationId }, { user })
      businessDayIds.push(day._id)
      await createOutboxEntry()

      const closed = await businessDays().closeDay({ businessDayId: day._id }, { user })

      assert.strictEqual(closed.status, BusinessDayStatus.CLOSING_REQUESTED)
      assert.strictEqual(closed.closedBy, user._id)
    })
  })
})
