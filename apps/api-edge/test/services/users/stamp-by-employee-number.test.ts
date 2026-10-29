// Stempeln per Personalnummer (panary/panary-core#1197): ueber die echte Hook-Kette (allowApiKey, authorize,
// resolveDeviceAccessScope, Audit) gegen die migrierte Test-SQLite. Jeder Test legt Konten und Geraete selbst an.
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { logger } from '@panary/shared-backend'

import { app } from '../../../src/app'
import { resetStampLimiters } from '../../../src/utils/stamp-attempt-limiter'
import { resetPinAttemptLimiter } from '@panary/shared-backend'

interface Stored {
  _id: string
  stampingId?: string | null
  startBreakAt?: string | null
}
interface Connection {
  apiKey: true
  deviceId: string
  deviceRole: string
  tenantId: string
  locationId: string
}

const internal = { provider: undefined } as const
const PIN = '4711'
const REJECTED = {
  code: 403,
  data: { code: 'STAMP_NUMBER_REJECTED' },
  message: 'Personalnummer ungueltig oder nicht zulaessig.',
}

type StampService = {
  lookupByEmployeeNumber: (d: unknown, p: unknown) => Promise<{ firstName: string; lastNameInitial: string }>
  stampByEmployeeNumber: (
    d: unknown,
    p: unknown,
  ) => Promise<{ _id: string; firstName: string; action: string; state: string }>
  verifyPin: (d: unknown, p: unknown) => Promise<{ operatorToken?: string }>
}

describe('users.stampByEmployeeNumber / lookupByEmployeeNumber', () => {
  const tenantId = uuidv7()
  let locationId: string
  let counter = 100000 + Math.floor(Math.random() * 700000)
  const nextNumber = () => String(counter++)
  const svc = () => app.service('users') as unknown as StampService

  const device = async (extra: Record<string, unknown> = {}, tenant = tenantId): Promise<Connection> => {
    const rec = (await app
      .service('devices')
      .create(
        { name: 'Kasse Nummer', type: 'pos-counter', tenantId: tenant, locationId, ...extra } as never,
        internal,
      )) as {
      _id: string
      deviceId: string
    }
    onTestFinished(async () => {
      await app
        .service('devices')
        .remove(rec._id, internal)
        .catch(() => undefined)
    })
    return { apiKey: true, deviceId: rec.deviceId, deviceRole: 'device:pos-client', tenantId: tenant, locationId }
  }

  const person = async (over: Record<string, unknown> = {}, number = nextNumber()) => {
    const created = (await app.service('users').create(
      {
        firstName: 'Anna',
        lastName: 'Berger',
        role: 'tenant:staff',
        tenantId,
        activeLocationId: locationId,
        isPosUser: true,
        posPin: PIN,
        employeeNumber: number,
        ...over,
      } as never,
      internal,
    )) as Stored
    onTestFinished(async () => {
      const cur = (await app
        .service('users')
        .get(created._id, internal)
        .catch(() => null)) as Stored | null
      if (cur?.stampingId)
        await app
          .service('working-times')
          .remove(cur.stampingId, internal)
          .catch(() => undefined)
      await app
        .service('users')
        .remove(created._id, internal)
        .catch(() => undefined)
    })
    return { ...created, number }
  }

  const params = (connection: Connection, extra: Record<string, unknown> = {}) => ({
    provider: 'socketio',
    connection,
    query: {},
    ...extra,
  })
  const stamp = (number: string, action: string, c: Connection, extra?: Record<string, unknown>) =>
    svc().stampByEmployeeNumber({ employeeNumber: number, action }, params(c, extra))
  const lookup = (number: string, c: Connection) => svc().lookupByEmployeeNumber({ employeeNumber: number }, params(c))
  const stampOf = async (id: string) => ((await app.service('users').get(id, internal)) as Stored).stampingId ?? null

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Nummer',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id
  })
  afterAll(async () => {
    if (locationId) await app.service('locations').remove(locationId, internal)
    await app.teardown()
  })
  beforeEach(() => {
    resetStampLimiters()
    resetPinAttemptLimiter()
  })

  it('lookup liefert Vorname und Initial und bucht nichts', async () => {
    const anna = await person()
    const c = await device()
    await expect(lookup(anna.number, c)).resolves.toEqual({ firstName: 'Anna', lastNameInitial: 'B' })
    expect(await stampOf(anna._id)).toBeNull()
  })

  it('stempelt ein, in die Pause, aus der Pause und aus — Zustand und Audit-Event je Buchung', async () => {
    const anna = await person()
    const c = await device()

    await expect(stamp(anna.number, 'checkin', c)).resolves.toEqual({
      _id: anna._id,
      firstName: 'Anna',
      action: 'checkin',
      state: 'IN',
    })
    expect(await stampOf(anna._id)).toEqual(expect.any(String))
    await expect(stamp(anna.number, 'startBreak', c)).resolves.toMatchObject({ state: 'BREAK' })
    await expect(stamp(anna.number, 'endBreak', c)).resolves.toMatchObject({ state: 'IN' })
    await expect(stamp(anna.number, 'checkout', c)).resolves.toMatchObject({ state: 'OUT' })

    // Test-Lesezugriff: der Query-Validator kennt die verschachtelten Pfade, die Tabelle nur die flachen Spalten.
    const rows = (await (app.get('sqliteClient') as any)('audit-events').where({ target_entityId: anna._id })) as {
      action: string
      actor: string | { deviceId?: string }
    }[]
    const events = rows.map(r => ({
      action: r.action,
      actor: typeof r.actor === 'string' ? JSON.parse(r.actor) : r.actor,
    }))
    const mine = events.filter(e => e.actor?.deviceId === c.deviceId)
    expect(mine.map(e => e.action).sort()).toEqual(['BREAK_END', 'BREAK_START', 'CLOCK_IN', 'CLOCK_OUT'])
  })

  it('Zustandsmeldungen kommen erst nach erfolgreicher Aufloesung und zaehlen nicht als Fehlversuch', async () => {
    const anna = await person()
    const c = await device()
    for (let i = 0; i < 8; i++) {
      await expect(stamp(anna.number, 'checkout', c)).rejects.toMatchObject({ code: 409 })
    }
    await expect(stamp(anna.number, 'checkin', c)).resolves.toMatchObject({ state: 'IN' })
  })

  it('lehnt unbekannte, archivierte, nicht zugewiesene, Leitungs- und Fremdmandanten-Nummern mit derselben Antwort ab', async () => {
    const archived = await person({ status: 'ARCHIVED' })
    const manager = await person({ role: 'tenant:manager' })
    const owner = await person({ role: 'tenant:owner' })
    const technician = await person({ role: 'tenant:technician' })
    const foreign = await person({ tenantId: uuidv7() })
    const assignedTo = await person()
    const stranger = await person()
    const c = await device({ deviceAccessMode: 'assigned', assignedUserIds: [assignedTo._id] })
    const other = await device()

    const cases: [string, string, Connection][] = [
      ['unbekannt', '999999', other],
      ['archiviert', archived.number, other],
      ['Manager', manager.number, other],
      ['Owner', owner.number, other],
      ['Techniker', technician.number, other],
      ['fremder Mandant', foreign.number, other],
      ['nicht zugewiesen', stranger.number, c],
    ]
    const seen: unknown[] = []
    for (const [, number, conn] of cases) {
      resetStampLimiters()
      const e = await stamp(number, 'checkin', conn).catch(err => err)
      expect(e).toMatchObject(REJECTED)
      seen.push({ name: e.name, code: e.code, message: e.message, data: e.data })
      await expect(lookup(number, conn)).rejects.toMatchObject(REJECTED)
    }
    expect(new Set(seen.map(s => JSON.stringify(s))).size).toBe(1)
    for (const u of [archived, manager, owner, technician, foreign, stranger]) expect(await stampOf(u._id)).toBeNull()
  })

  it('weist Nicht-Geraete ab, ohne die Edge-weite Sperre zu beruehren', async () => {
    const anna = await person()
    const c = await device()
    const staff = { _id: anna._id, role: 'tenant:staff', tenantId }
    for (let i = 0; i < 60; i++) {
      await expect(
        svc().lookupByEmployeeNumber({ employeeNumber: anna.number }, { user: staff }),
      ).rejects.toMatchObject(REJECTED)
    }
    await expect(lookup(anna.number, c)).resolves.toMatchObject({ firstName: 'Anna' })
  })

  it('verlangt genau 6 Ziffern und zaehlt Formatfehler nicht', async () => {
    const c = await device()
    for (const bad of ['12345', '1234567', 'abcdef', '12 456', '']) {
      await expect(lookup(bad, c)).rejects.toMatchObject({ code: 400 })
    }
    await expect(stamp('482913', 'quatsch', c)).rejects.toMatchObject({ code: 400 })
    for (let i = 0; i < 4; i++) await expect(lookup('999999', c)).rejects.toMatchObject({ code: 403 })
    await expect(lookup('999999', c)).rejects.toMatchObject({ code: 403 })
  })

  it('sperrt das Geraet nach 5 Fehlversuchen mit retryAfterSeconds, auch fuer eine gueltige Nummer', async () => {
    const anna = await person()
    const c = await device()
    for (let i = 0; i < 5; i++) await expect(lookup('999999', c)).rejects.toMatchObject({ code: 403 })

    const locked = await lookup(anna.number, c).catch(e => e)
    expect(locked).toMatchObject({ code: 429, data: { code: 'STAMP_LOCKED' } })
    expect(locked.data.retryAfterSeconds).toBeGreaterThan(0)
    expect(locked.data.retryAfterSeconds).toBeLessThanOrEqual(60)
    await expect(stamp(anna.number, 'checkin', c)).rejects.toMatchObject({ code: 429 })
    expect(await stampOf(anna._id)).toBeNull()
  })

  it('nach Ablauf der Sperre wird eine gueltige Nummer wieder angenommen', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => void vi.useRealTimers())
    const anna = await person()
    const c = await device()
    for (let i = 0; i < 5; i++) await lookup('999999', c).catch(() => undefined)
    await expect(lookup(anna.number, c)).rejects.toMatchObject({ code: 429 })
    vi.setSystemTime(Date.now() + 61_000)
    await expect(lookup(anna.number, c)).resolves.toMatchObject({ firstName: 'Anna' })
  })

  it('Treffer setzen den Zaehler nicht zurueck, erst die erfolgreiche Buchung', async () => {
    const anna = await person()
    const c = await device()
    for (let i = 0; i < 4; i++) await lookup('999999', c).catch(() => undefined)
    await expect(lookup(anna.number, c)).resolves.toBeDefined()
    await expect(lookup('999999', c)).rejects.toMatchObject({ code: 403 })
    // Fuenfter Fehlversuch hat gesperrt: Treffer hat nicht zurueckgesetzt.
    await expect(lookup(anna.number, c)).rejects.toMatchObject({ code: 429 })

    resetStampLimiters()
    for (let i = 0; i < 4; i++) await lookup('999999', c).catch(() => undefined)
    await stamp(anna.number, 'checkin', c)
    for (let i = 0; i < 4; i++) await expect(lookup('999999', c)).rejects.toMatchObject({ code: 403 })
  })

  it('ein zweites Geraet ist waehrend der Sperre des ersten nicht betroffen, der PIN-Zaehler bleibt unberuehrt', async () => {
    const anna = await person()
    const c1 = await device()
    const c2 = await device()
    for (let i = 0; i < 5; i++) await lookup('999999', c1).catch(() => undefined)
    await expect(lookup(anna.number, c1)).rejects.toMatchObject({ code: 429 })
    await expect(stamp(anna.number, 'checkin', c2)).resolves.toMatchObject({ state: 'IN' })
    // PIN-Login der Kollegin am gesperrten Geraet funktioniert.
    await expect(svc().verifyPin({ userId: anna._id, pin: PIN }, { connection: c1 })).resolves.toBeDefined()
  })

  it('wertet ein mitgeschicktes Bediener-Token nicht aus', async () => {
    const anna = await person()
    const ben = await person({ firstName: 'Ben' })
    const c = await device()
    const token = (await svc().verifyPin({ userId: ben._id, pin: PIN }, { connection: c })).operatorToken as string
    await expect(stamp(anna.number, 'checkin', c, { query: { operatorToken: token } })).resolves.toMatchObject({
      _id: anna._id,
      state: 'IN',
    })
    await expect(stamp(ben.number, 'checkin', c, { query: { operatorToken: `${token}x` } })).resolves.toMatchObject({
      _id: ben._id,
    })
  })

  it('schreibt keine Personalnummer in die Logs', async () => {
    const lines: string[] = []
    const spy = (level: 'warn' | 'info' | 'error' | 'debug') =>
      vi.spyOn(logger, level).mockImplementation(((...a: unknown[]) => void lines.push(JSON.stringify(a))) as never)
    const spies = (['warn', 'info', 'error', 'debug'] as const).map(spy)
    onTestFinished(() => spies.forEach(s => s.mockRestore()))
    const anna = await person()
    const c = await device()
    for (let i = 0; i < 6; i++) await lookup('999998', c).catch(() => undefined)
    await lookup(anna.number, c).catch(() => undefined)
    const joined = lines.join('\n')
    expect(joined).toContain('security.stamp_number_')
    expect(joined).toContain('deviceFailures')
    expect(joined).not.toContain('999998')
    expect(joined).not.toContain(anna.number)
  })
})
