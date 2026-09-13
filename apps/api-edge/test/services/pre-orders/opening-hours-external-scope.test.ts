import assert from 'assert'
import { BadRequest } from '@feathersjs/errors'
import { onTestFinished } from 'vitest'
import { uuidv7 } from 'uuidv7'

import { app } from '../../../src/app'

/**
 * Öffnungszeiten-Ausnahmen über den EXTERNEN Aufrufpfad (panary/panary-core#286).
 *
 * `opening-hours-location-scope.test.ts` ruft mit `provider: undefined` auf — damit
 * laufen `authorize()` und `multiTenancy()` nicht mit. Gemessen wird dort also der Hook
 * und der Adapter, nicht die Kette, die ein POS-Gerät tatsächlich durchläuft: Rolle
 * prüfen → `locationId` stempeln → Öffnungszeiten prüfen. Diese Suite schließt das,
 * indem sie `provider: 'rest'` + `params.user` setzt (`authenticated: true`, damit
 * `authenticate('jwt')` durchlässt, ohne ein Token zu bauen).
 *
 * Zwei Aussagen, die nur hier messbar sind:
 *
 * 1. **Der Stamp reicht.** Eine Vorbestellung ohne `locationId` im Body — so schickt sie
 *    der POS — bekommt die Filiale von `multiTenancy` aus `activeLocationId`, und der
 *    Öffnungszeiten-Hook entscheidet danach filialgenau.
 * 2. **Der Befund am POS-Dialog, erstmals gemessen statt abgeleitet.** Das Issue leitete
 *    aus `.claude/rules/security.md` §4 ab, dass `multiTenancy` für `TENANT_OWNER` und
 *    `TENANT_MANAGER` keinen Location-Filter setzt und ein so angemeldeter Nutzer die
 *    Ausnahmen aller Filialen bekäme. Der Test hält beide Seiten fest: ohne `locationId`
 *    in der Query kommen die Zeilen beider Filialen, mit `locationId` genau die eigenen.
 *    Deshalb setzt der Dialog den Filter selbst, statt sich auf den Server-Scope zu
 *    verlassen.
 *
 * Jeder Test hat sein eigenes Datum und räumt per `onTestFinished` ab (Code-Style §10);
 * die Suite teilt ihre SQLite mit allen anderen.
 */
describe('pre-orders — Öffnungszeiten über den externen Aufrufpfad (Integration)', () => {
  // IDs je Lauf neu (Code-Style §10.2): Die Test-SQLite ist eine Datei und überlebt
  // einen Abbruch — feste IDs kollidierten dann mit den Resten des vorherigen Laufs,
  // und dieser Fehlschlag sähe aus wie ein Produktionsbug.
  const TENANT = uuidv7()
  const OWN_LOCATION = uuidv7()
  const OTHER_LOCATION = uuidv7()

  const internal = { provider: undefined } as const

  const DATE_FOREIGN_CLOSED = '2026-07-14'
  const DATE_OWN_CLOSED = '2026-07-15'
  const DATE_OWNER_QUERY = '2026-07-16'

  const wallClock = (date: string, utcHour: number) => `${date}T${String(utcHour).padStart(2, '0')}:00:00.000Z`

  const minimalSettings = {
    generalSettings: {
      systemOfUnits: 'metric',
      defaultWeightUnit: 'kg',
      defaultVolumeUnit: 'L',
      timezone: 'Europe/Berlin',
    },
    printSettings: {
      maxNameCharacters: 30,
      mqttServerProtocol: 'ws',
      mqttServerUrl: 'localhost',
      mqttServerPort: 1883,
      printerSequence: [],
      printers: [],
      separationCharacter: '-',
      separationCharacterCount: 40,
      showDialogAfterOrder: false,
    },
    serverSettings: { path: '/ws', timeout: 5000, reconnection: true, autoConnect: true },
    discountSettings: { enabled: false, discounts: [] },
    pagerSettings: { enabled: false, pagers: [] },
    tableSettings: { enabled: false, rooms: [] },
    genericUserSettings: { autoLogOffTime: 30, autoLogOffTimeUnit: 'minutes' },
    genericProductSettings: { generalSideDishPrice: 0, generalDrinkPrice: 0 },
    taxSettings: { A: { taxRate: 19, name: 'Normal' } },
    openingHoursSettings: {
      enabled: true,
      regular: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open: '10:00', close: '22:00', closed: false })),
    },
  }

  let staffUser: Record<string, unknown>
  let ownerUser: Record<string, unknown>

  /** Params eines echten externen Aufrufs — ohne JWT, aber mit allen Hooks. */
  const asUser = (user: Record<string, unknown>) => ({ provider: 'rest', authenticated: true, user })

  const addException = async (locationId: string, date: string, fields: Record<string, unknown>) => {
    const created = (await app
      .service('opening-hour-exceptions')
      .create({ tenantId: TENANT, locationId, date, ...fields } as never, internal)) as { _id: string }

    onTestFinished(async () => {
      try {
        await app.service('opening-hour-exceptions').remove(created._id, internal)
      } catch {
        // bereits entfernt
      }
    })

    return created
  }

  /** Wie der POS sie schickt: OHNE locationId — die stempelt multiTenancy. */
  const preOrderBody = (scheduledFor: string) =>
    ({
      scheduledFor,
      status: 'pending',
      customerContact: { name: 'Externer Kunde', phone: '0123456789' },
      lineItems: [],
    }) as never

  beforeAll(async () => {
    await app.setup()

    await app.service('locations').create(
      {
        _id: OWN_LOCATION,
        tenantId: TENANT,
        name: 'Filiale A (286 extern)',
        address: { street: 'Teststr. 2', city: 'Teststadt', postalCode: '12345', country: 'DE' },
        settings: minimalSettings,
      } as never,
      internal,
    )

    staffUser = (await app.service('users').create(
      {
        firstName: 'Extern',
        lastName: 'Staff',
        role: 'tenant:staff',
        tenantId: TENANT,
        activeLocationId: OWN_LOCATION,
      } as never,
      internal,
    )) as Record<string, unknown>

    ownerUser = (await app.service('users').create(
      {
        firstName: 'Extern',
        lastName: 'Owner',
        role: 'tenant:owner',
        tenantId: TENANT,
        activeLocationId: OWN_LOCATION,
      } as never,
      internal,
    )) as Record<string, unknown>
  })

  afterAll(async () => {
    for (const u of [staffUser, ownerUser]) {
      try {
        await app.service('users').remove(u?.['_id'] as string, internal)
      } catch {
        // bereits entfernt
      }
    }
    try {
      await app.service('locations').remove(OWN_LOCATION, internal)
    } catch {
      // bereits entfernt
    }
  })

  it('nimmt die Vorbestellung an, wenn nur eine FREMDE Filiale geschlossen hat', async () => {
    // Der Body trägt keine locationId — sie kommt aus dem Stamp. Läuft der Filter über
    // den gestempelten Wert, greift die fremde „geschlossen"-Zeile nicht.
    await addException(OTHER_LOCATION, DATE_FOREIGN_CLOSED, { closed: true, label: 'Feiertag Filiale B' })

    const created = (await app
      .service('pre-orders')
      .create(preOrderBody(wallClock(DATE_FOREIGN_CLOSED, 9)), asUser(staffUser) as never)) as {
      _id: string
      locationId: string
    }

    onTestFinished(async () => {
      try {
        await app.service('pre-orders').remove(created._id, internal)
      } catch {
        // bereits entfernt
      }
    })

    assert.ok(created._id)
    assert.strictEqual(created.locationId, OWN_LOCATION, 'multiTenancy muss die eigene Filiale stempeln')
  })

  it('lehnt ab, wenn die EIGENE Filiale geschlossen hat — Gegenprobe zum Stamp', async () => {
    await addException(OTHER_LOCATION, DATE_OWN_CLOSED, { closed: false, open: '00:00', close: '23:59' })
    await addException(OWN_LOCATION, DATE_OWN_CLOSED, { closed: true, label: 'Feiertag Filiale A' })

    await assert.rejects(
      () => app.service('pre-orders').create(preOrderBody(wallClock(DATE_OWN_CLOSED, 9)), asUser(staffUser) as never),
      (err: unknown) => {
        assert.ok(err instanceof BadRequest, `BadRequest erwartet, war ${String(err)}`)
        assert.match((err as BadRequest).message, /an diesem Tag geschlossen/)
        return true
      },
    )
  })

  it('ein tenant:owner sieht ohne eigenen Filter die Ausnahmen ALLER Filialen', async () => {
    // Der Befund hinter dem Dialog-Fix, gemessen statt aus der Regeldatei abgeleitet:
    // `multiTenancy` setzt für privilegierte Rollen keinen Location-Filter.
    await addException(OTHER_LOCATION, DATE_OWNER_QUERY, { closed: true })
    await addException(OWN_LOCATION, DATE_OWNER_QUERY, { closed: false, open: '10:00', close: '14:00' })

    const alle = (await app.service('opening-hour-exceptions').find({
      query: { date: DATE_OWNER_QUERY },
      ...asUser(ownerUser),
    } as never)) as { data?: Array<{ locationId: string }> } | Array<{ locationId: string }>
    const alleRows = Array.isArray(alle) ? alle : (alle.data ?? [])

    assert.strictEqual(alleRows.length, 2, 'ohne Filter sieht der Owner beide Filialen')
    assert.ok(
      alleRows.some(r => r.locationId === OTHER_LOCATION),
      'darunter die fremde Filiale',
    )
  })

  it('… und genau die eigene, sobald der Aufrufer locationId mitgibt (Dialog-Fix)', async () => {
    // Gegenprobe zum Test davor — das ist die Query, die der POS-Dialog seit #290 stellt.
    await addException(OTHER_LOCATION, DATE_OWNER_QUERY, { closed: true })
    const own = await addException(OWN_LOCATION, DATE_OWNER_QUERY, { closed: false, open: '10:00', close: '14:00' })

    const gefiltert = (await app.service('opening-hour-exceptions').find({
      query: { date: { $gte: DATE_OWNER_QUERY }, locationId: OWN_LOCATION, $limit: 200, $sort: { date: 1 } },
      ...asUser(ownerUser),
    } as never)) as { data?: Array<{ _id: string; locationId: string }> } | Array<{ _id: string; locationId: string }>
    const rows = Array.isArray(gefiltert) ? gefiltert : (gefiltert.data ?? [])

    assert.strictEqual(rows.length, 1, 'genau die eigene Zeile')
    assert.strictEqual(rows[0]._id, own._id)
    assert.strictEqual(rows[0].locationId, OWN_LOCATION)
  })
})
