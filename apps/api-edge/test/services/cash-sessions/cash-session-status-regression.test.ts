// Eine Lade geht nur vorwärts: open → counting → closed → audited
// (panary/panary-core#717).
//
// `cash-sessions.patch` ließ jeden Status zu; eine geschlossene Lade ließ sich
// zurück auf `open` setzen — am create-Schutz aus #714 vorbei. Über die echte
// Hook-Kette, vom Gerät mit Bediener-Token und intern; jeder Test legt seine
// Lade an und räumt sie ab (testing.md §10.2).
import { BadRequest, NotFound } from '@feathersjs/errors'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import { AppError } from '@panary/shared-common'

import { app } from '../../../src/app'

interface CashSessionLite {
  _id: string
  status: string
}

describe('cash-sessions — kein Statusrückschritt', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const
  const PIN = '4711'

  let locationId: string
  let cashierId: string

  const cashSessions = () =>
    app.service('cash-sessions') as unknown as {
      create: (data: unknown, params: unknown) => Promise<CashSessionLite>
      get: (id: string, params: unknown) => Promise<CashSessionLite>
      patch: (id: string, data: unknown, params: unknown) => Promise<CashSessionLite>
      remove: (id: string, params: unknown) => Promise<unknown>
    }

  /** Lade für den Kassierer in einem eigenen Geschäftstag, optional schon im Zielstatus. */
  const drawer = async (status?: 'counting' | 'closed' | 'audited') => {
    const created = await cashSessions().create(
      { tenantId, locationId, businessDayId: uuidv7(), label: 'Lade', openedBy: cashierId, openingFloatCents: 0 },
      internal,
    )
    onTestFinished(async () => {
      await cashSessions()
        .remove(created._id, internal)
        .catch(() => undefined)
    })
    if (status) await cashSessions().patch(created._id, { status }, internal)
    return created._id
  }

  /** Geräte-Aufruf mit dem Token des Kassierers — der Weg des POS. */
  const deviceParams = async () => {
    const connection = {
      apiKey: true,
      deviceId: uuidv7(),
      deviceRole: 'device:pos-client',
      tenantId,
      locationId,
    }
    const users = app.service('users') as unknown as {
      verifyPin: (data: unknown, params: unknown) => Promise<{ operatorToken?: string }>
    }
    const { operatorToken } = await users.verifyPin({ userId: cashierId, pin: PIN }, { connection })
    return { provider: 'socketio', connection, query: { operatorToken } }
  }

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Statusfolge',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id
    cashierId = (
      (await app.service('users').create(
        {
          firstName: 'Status',
          lastName: 'Kassierer',
          role: 'tenant:staff',
          tenantId,
          activeLocationId: locationId,
          isPosUser: true,
          posPin: PIN,
        } as never,
        internal,
      )) as { _id: string }
    )._id
  })

  afterAll(async () => {
    if (locationId) await app.service('locations').remove(locationId, internal)
    if (cashierId) await app.service('users').remove(cashierId, internal)
    await app.teardown()
  })

  it('vom Gerät lässt sich eine geschlossene Lade nicht wieder öffnen', async () => {
    const id = await drawer('closed')

    const error = await cashSessions()
      .patch(id, { status: 'open' }, await deviceParams())
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BadRequest)
    expect((error as BadRequest).data).toEqual({
      code: AppError.CASH_SESSION_STATUS_REGRESSION,
      from: 'closed',
      to: 'open',
    })
    expect((await cashSessions().get(id, internal)).status).toBe('closed')
  })

  it('auch intern nicht — und nicht von closed zurück auf counting', async () => {
    const id = await drawer('closed')

    await expect(cashSessions().patch(id, { status: 'counting' }, internal)).rejects.toMatchObject({
      data: { code: AppError.CASH_SESSION_STATUS_REGRESSION },
    })
  })

  it('eine plombierte Lade bleibt plombiert', async () => {
    const id = await drawer('audited')

    await expect(cashSessions().patch(id, { status: 'closed' }, internal)).rejects.toBeInstanceOf(BadRequest)
  })

  it('vorwärts geht es weiter: open → counting → closed vom Gerät', async () => {
    const id = await drawer()
    const params = await deviceParams()

    await cashSessions().patch(id, { status: 'counting' }, params)
    const closed = await cashSessions().patch(id, { status: 'closed' }, params)

    expect(closed.status).toBe('closed')
  })

  it('ein Patch ohne Statuswechsel an einer geschlossenen Lade bleibt erlaubt', async () => {
    const id = await drawer('closed')

    const patched = await cashSessions().patch(id, { status: 'closed', notes: 'nachgetragen' }, internal)

    expect(patched.status).toBe('closed')
  })

  it('Sync-Apply bleibt ungesperrt — ein fertiger Stand wird nicht abgelehnt', async () => {
    const id = await drawer('closed')

    const applied = await cashSessions().patch(id, { status: 'open' }, { ...internal, fromSync: true })

    expect(applied.status).toBe('open')
  })

  it('die Lade eines fremden Mandanten verrät ihren Status nicht', async () => {
    const id = await drawer('closed')
    const outsider = {
      provider: 'rest',
      user: { _id: uuidv7(), role: 'tenant:owner', tenantId: uuidv7(), locationId: null },
      authenticated: true,
    }

    const error = await cashSessions()
      .patch(id, { status: 'open' }, outsider as never)
      .catch((e: unknown) => e)

    // Der Adapter-Scope findet die Lade nicht (404); der Hook darf vorher nichts über sie sagen.
    expect(error).toBeInstanceOf(NotFound)
    expect((await cashSessions().get(id, internal)).status).toBe('closed')
  })
})
