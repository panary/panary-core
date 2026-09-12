import assert from 'assert'
import { BadRequest } from '@feathersjs/errors'
import { onTestFinished } from 'vitest'

import { app } from '../../../src/app'

/**
 * Integrationstest zur filialgenauen Auswahl der Öffnungszeiten-Ausnahmen
 * (panary/panary-core#286) — gegen die echte Test-SQLite und die volle Hook-Kette.
 *
 * **Warum zusätzlich zur Unit-Spec:** `validate-opening-hours.hook.spec.ts` mockt den
 * `opening-hour-exceptions`-Service und prüft damit, *dass* der Hook mit `locationId`
 * anfragt — nicht, dass der Knex/SQLite-Adapter danach filtert. Genau diese Lücke ist
 * im Abschluss von #286 als „nur gegen einen Mock belegt" benannt und bleibt sonst
 * offen: Der Nachfilter im Hook deckt „zu viel geliefert" ab, aber ein Query-Filter,
 * der die EIGENE Zeile wegschneidet, fiele still aus — der Feiertag wäre entwertet,
 * ohne dass ein Test oder ein Log es zeigt.
 *
 * Die fremde Zeile wird bewusst ZUERST angelegt: `_id` ist uuidv7, also zeitsortiert —
 * bei einer Rückgabe ohne `$sort` steht sie damit vorn, genau dort, wo
 * `getOpeningHoursForDate` (`exceptions.find(e => e.date === dateStr)`) vorher die
 * falsche nahm.
 *
 * **Jeder Test hat sein eigenes Datum und legt seine Zeilen selbst an** (Code-Style §10):
 * Die erste Fassung baute die Ausnahmen in Test 1 auf und nutzte sie in Test 2/3 weiter —
 * `vitest run --sequence.shuffle` war damit rot. Aufgeräumt wird über `onTestFinished`
 * statt über Listen im `describe`-Scope; die Suite teilt ihre SQLite mit allen anderen
 * (`fileParallelism: false`, eine Datei für alle Suites).
 *
 * **Mutationsprobe am Hook, gemessen 2026-09-12.** Sie sagt nicht nur, dass diese Suite
 * etwas fängt, sondern welche Schicht sie überhaupt sehen kann:
 *
 * | Mutation im Hook                               | rot hier | Aussage |
 * |---|---|---|
 * | `locationId` aus der Query entfernt            | **0** | Der Nachfilter fängt es vollständig ab — die Query-Ebene ist am Verhalten nicht messbar. Das prüft die Unit-Spec (dort 4 rot). |
 * | Nachfilter `ownLocationExceptions` entfernt    | **0** | Die Query filtert wirklich; der Nachfilter ist im echten Betrieb redundant (Defense-in-Depth, Unit-Spec: 7 rot). |
 * | **beides** entfernt (Zustand vor #286)         | **3** | Der ursprüngliche Befund, am echten Adapter reproduziert: Die fremde „geschlossen"-Zeile greift, und die Meldung nennt sie. |
 * | Query auf eine gültige, unbenutzte Filial-UUID | **2** | Die gefährliche Gegenrichtung: Schneidet die Query die EIGENE Zeile weg, fällt der Feiertag still aus der Prüfung. |
 * | Query auf die FREMDE Filiale                   | **2** | Dieselben zwei — nicht weil die Probe nichts misst, sondern weil der Nachfilter beide Mutationen auf dieselbe leere Menge abbildet. |
 *
 * ⚠️ Eine sechste Mutation (`locationId + '-falsch'`) sah mit 4 roten Tests nach der
 * stärksten Messung aus und war die schwächste: Der Wert verletzt `format: uuid`, also
 * scheiterte schon `validateQuery` — gemessen wurde ein 400er, nicht der Filter.
 */
describe('pre-orders — Öffnungszeiten-Ausnahmen filialgenau (Integration)', () => {
  const TENANT = '019fffff-2860-7000-8000-000000000001'
  const OWN_LOCATION = '019fffff-2860-7000-8000-0000000000a1'
  const OTHER_LOCATION = '019fffff-2860-7000-8000-0000000000a2'

  const internal = { provider: undefined } as const

  // Feste Instants, nichts aus der Uhr. Die Filiale hat an allen Wochentagen
  // 10:00–22:00 offen, das Ergebnis hängt also nur an der Ausnahme. Im Juni gilt
  // Sommerzeit: 09:00 UTC = 11:00 Berlin, 13:00 UTC = 15:00 Berlin.
  const wallClock = (date: string, utcHour: number) => `${date}T${String(utcHour).padStart(2, '0')}:00:00.000Z`

  // Ein eigenes Datum je Test — so hängt kein Test an den Zeilen eines anderen.
  const DATE_ADAPTER = '2026-06-20'
  const DATE_OWN_WINDOW_INSIDE = '2026-06-22'
  const DATE_OWN_WINDOW_OUTSIDE = '2026-06-23'
  const DATE_FOREIGN_ONLY = '2026-06-24'
  const DATE_OWN_CLOSED = '2026-06-25'

  // Das Settings-Schema verlangt zehn Unterbäume; hier steht nur das Minimum, das
  // `validateData` passieren lässt. Fachlich zählen allein `openingHoursSettings`
  // (der Hook prüft `enabled` + `regular`) und `generalSettings.timezone` — alles
  // andere ist Pflichtfeld-Ballast und bewusst nicht realitätsnah gefüllt.
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

  interface ExceptionFields {
    closed: boolean
    open?: string
    close?: string
    label?: string
  }

  /** Legt eine Ausnahme an und räumt sie am Ende DIESES Tests wieder ab. */
  const addException = async (locationId: string, date: string, fields: ExceptionFields) => {
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

  const preOrderData = (scheduledFor: string) =>
    ({
      tenantId: TENANT,
      locationId: OWN_LOCATION,
      scheduledFor,
      status: 'pending',
      customerContact: { name: 'Testkunde', phone: '0123456789' },
      lineItems: [],
    }) as never

  const createPreOrder = async (scheduledFor: string) => {
    const created = (await app.service('pre-orders').create(preOrderData(scheduledFor), internal)) as { _id: string }

    onTestFinished(async () => {
      try {
        await app.service('pre-orders').remove(created._id, internal)
      } catch {
        // bereits entfernt
      }
    })

    return created
  }

  const expectRejected = (scheduledFor: string, messagePattern: RegExp) =>
    assert.rejects(
      () => app.service('pre-orders').create(preOrderData(scheduledFor), internal),
      (err: unknown) => {
        assert.ok(err instanceof BadRequest, `BadRequest erwartet, war ${String(err)}`)
        assert.match((err as BadRequest).message, messagePattern)
        return true
      },
    )

  beforeAll(async () => {
    await app.setup()

    await app.service('locations').create(
      {
        _id: OWN_LOCATION,
        tenantId: TENANT,
        name: 'Filiale A (286)',
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
        settings: minimalSettings,
      } as never,
      internal,
    )
  })

  afterAll(async () => {
    try {
      await app.service('locations').remove(OWN_LOCATION, internal)
    } catch {
      // bereits entfernt
    }
  })

  it('der SQLite-Adapter filtert die Ausnahmen nach locationId', async () => {
    // Die Aussage, die die Unit-Spec nicht treffen kann: Beide Zeilen liegen am selben
    // Datum in derselben Tabelle, die fremde zuerst.
    await addException(OTHER_LOCATION, DATE_ADAPTER, { closed: true, label: 'Feiertag Filiale B' })
    const own = await addException(OWN_LOCATION, DATE_ADAPTER, { closed: false, open: '10:00', close: '14:00' })

    const rows = (await app.service('opening-hour-exceptions').find({
      query: { date: DATE_ADAPTER, tenantId: TENANT, locationId: OWN_LOCATION },
      paginate: false,
      ...internal,
    })) as Array<{ _id: string; locationId: string }>

    assert.strictEqual(rows.length, 1, 'genau die eigene Zeile')
    assert.strictEqual(rows[0]._id, own._id)
    assert.strictEqual(rows[0].locationId, OWN_LOCATION)

    // Gegenprobe: Ohne den Filial-Filter liefert dieselbe Query BEIDE Zeilen — sonst
    // wäre der Test davor auch mit einer Tabelle grün, die die fremde Zeile gar nicht
    // enthält.
    const unfiltered = (await app.service('opening-hour-exceptions').find({
      query: { date: DATE_ADAPTER, tenantId: TENANT },
      paginate: false,
      ...internal,
    })) as unknown[]
    assert.strictEqual(unfiltered.length, 2, 'ungefiltert beide Zeilen')
  })

  it('wendet das Zeitfenster der eigenen Ausnahme an (11:00 in 10:00–14:00)', async () => {
    await addException(OTHER_LOCATION, DATE_OWN_WINDOW_INSIDE, { closed: true })
    await addException(OWN_LOCATION, DATE_OWN_WINDOW_INSIDE, { closed: false, open: '10:00', close: '14:00' })

    const created = await createPreOrder(wallClock(DATE_OWN_WINDOW_INSIDE, 9))
    assert.ok(created._id)
  })

  it('lehnt 15:00 gegen die eigene Ausnahme ab und nennt deren Zeiten', async () => {
    // Beweist, dass die Entscheidung aus der EIGENEN Zeile kommt: Die fremde sagt
    // „geschlossen", die reguläre Zeit ginge bis 22:00 — nur die eigene endet um 14:00.
    await addException(OTHER_LOCATION, DATE_OWN_WINDOW_OUTSIDE, { closed: true })
    await addException(OWN_LOCATION, DATE_OWN_WINDOW_OUTSIDE, { closed: false, open: '10:00', close: '14:00' })

    await expectRejected(wallClock(DATE_OWN_WINDOW_OUTSIDE, 13), /10:00 bis 14:00/)
  })

  it('lässt die „geschlossen"-Ausnahme einer fremden Filiale nicht greifen', async () => {
    // Der ursprüngliche Befund: An diesem Tag hat NUR Filiale B geschlossen.
    await addException(OTHER_LOCATION, DATE_FOREIGN_ONLY, { closed: true, label: 'Feiertag nur Filiale B' })

    const created = await createPreOrder(wallClock(DATE_FOREIGN_ONLY, 9))
    assert.ok(created._id, 'Vorbestellung für Filiale A muss durchgehen')
  })

  it('lehnt ab, sobald die eigene Filiale geschlossen ist — auch wenn die fremde offen hat', async () => {
    // Rollen vertauscht: Die fremde Zeile sagt „offen", die eigene „geschlossen". Ein
    // Test, der nur „nimm die zweite Zeile" belegte, wäre hier grün.
    await addException(OTHER_LOCATION, DATE_OWN_CLOSED, { closed: false, open: '00:00', close: '23:59' })
    await addException(OWN_LOCATION, DATE_OWN_CLOSED, { closed: true, label: 'Feiertag Filiale A' })

    await expectRejected(wallClock(DATE_OWN_CLOSED, 9), /an diesem Tag geschlossen/)
  })
})
