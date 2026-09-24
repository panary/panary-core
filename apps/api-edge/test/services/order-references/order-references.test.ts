import { uuidv7 } from 'uuidv7'
import { onTestFinished } from 'vitest'
import { OrderReferenceType } from '@panary/order-references/domain'
import { app } from '../../../src/app'

// Integrationstest fuer die Vorgangs-Referenzen (DSFinV-K `Bon_Referenzen`,
// Tz. 4.2.2 — panary/panary-core#348). Laeuft gegen die echte Test-SQLite und
// die volle Hook-Kette.
//
// 🚨 Die Append-only-Tests rufen `patch`/`remove` WIRKLICH auf, statt die
// `methods`-Liste zu inspizieren. Eine Policy-Spec, die nur die Registrierung
// liest, bleibt gruen, wenn jemand spaeter `patch` ergaenzt und die Spec
// mitzieht — der echte Aufruf wird in dem Moment rot. Dieselbe Lehre wie bei
// `time-clock-wiring.spec.ts`.
//
// Geprueft werden beide Schutzschichten getrennt:
//   1. App-Layer  — Feathers lehnt nicht registrierte Methoden ab.
//   2. DB-Layer   — SQLite-Trigger fangen einen direkten Knex-Bypass ab.
// Schicht 2 ist die eigentliche Absicherung: Schicht 1 faellt weg, sobald
// jemand `methods` erweitert.
describe('order-references — Vorgangs-Referenzen', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const

  let locationId: string
  let userId: string

  const referenceData = (extra: Record<string, unknown> = {}) => ({
    tenantId,
    locationId,
    refType: OrderReferenceType.STORNO,
    sourceOrderId: uuidv7(),
    refDate: new Date().toISOString(),
    refLocationId: locationId,
    refBusinessDayId: uuidv7(),
    ...extra,
  })

  /** Legt eine Referenz an. Kein Cleanup: die Tabelle ist append-only. */
  const createReference = async (extra: Record<string, unknown> = {}) =>
    (await app.service('order-references').create(referenceData(extra) as never, internal)) as {
      _id: string
      refType: string
      targetOrderId?: string
      refBusinessDayId?: string
    }

  beforeAll(async () => {
    await app.setup()

    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Vorgangs-Referenzen',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id

    // `restrictOrderToBusinessDay` loest die Filiale ueber den User auf und
    // wirft ohne ihn `NotAuthenticated` — die Storno-Tests unten legen echte
    // Bestellungen an und laufen durch die volle Hook-Kette.
    const user = (await app.service('users').create(
      {
        firstName: 'Vorgangs',
        lastName: 'Referenz',
        role: 'tenant:staff',
        tenantId,
        activeLocationId: locationId,
      } as never,
      internal,
    )) as { _id: string }
    userId = user._id
  })

  describe('Anlegen', () => {
    it('legt eine Storno-Referenz an', async () => {
      const created = await createReference()

      expect(created._id).toBeTruthy()
      expect(created.refType).toBe('Storno')
    })

    it('laesst targetOrderId leer — ein Storno erzeugt keinen neuen Vorgang', async () => {
      const created = await createReference()

      // `null`, nicht `undefined`: SQLite liefert die ungesetzte Spalte so
      // zurueck. Genau deshalb traegt das Schema einen `Type.Null()`-Zweig —
      // ohne ihn verwuerfe die Cloud den Sync-Push dieses Records terminal.
      expect(created.targetOrderId ?? null).toBeNull()
    })

    it('akzeptiert eine Referenz OHNE Geschaeftstag (Standalone-Modus)', async () => {
      // `order.businessDayId` ist optional — waere `refBusinessDayId` Pflicht,
      // schluege der Create hier fehl, und weil der schreibende Hook
      // best-effort ist, bliebe der Datensatz lautlos aus.
      const created = await createReference({ refBusinessDayId: undefined })

      expect(created._id).toBeTruthy()
    })

    it('weist einen externen Aufruf ab — Referenzen entstehen nur intern', async () => {
      // Abgelehnt wird hier bereits vom globalen Guard (`secure-by-default`,
      // „Access denied"), noch vor `blockExternalWrites` im Service. Der Test
      // haelt die AUSSAGE fest — extern kommt niemand an diesen Service — und
      // nicht, welche der beiden Schichten zuerst greift. `blockExternalWrites`
      // bleibt die zweite Schicht, falls der Pfad je fuer eine Rolle
      // freigegeben wird.
      await expect(
        app.service('order-references').create(
          referenceData() as never,
          {
            provider: 'rest',
            authenticated: true,
            user: { _id: uuidv7(), role: 'tenant:owner', tenantId, locationId },
          } as never,
        ),
      ).rejects.toThrow()
    })
  })

  // 🚨 Die Arbeitsteilung der beiden Schichten ist NICHT die naheliegende.
  // Am 2026-09-24 gemessen, nachdem eine Mutationsprobe (patch/remove in
  // `methods` ergaenzt) gruen blieb:
  //
  //   `methods: ['find','get','create']` schuetzt nur den EXTERNEN Weg.
  //   Ein interner Aufruf — `{ provider: undefined }`, also genau das, was
  //   Hooks, Seeds und Worker benutzen — laeuft durch und wird einzig vom
  //   SQLite-Trigger gestoppt (`patch` wirft SqliteError, `remove` einen
  //   GeneralError, beide mit „append-only" im Text).
  //
  // Der DB-Trigger ist damit nicht die „zusaetzliche" Absicherung, sondern die
  // einzige, die intern greift. Wer ihn beim Aufraeumen droppt, oeffnet den
  // Service fuer jeden internen Schreibzugriff, ohne dass eine Methodenliste
  // etwas davon merkt.
  describe('Append-only — interner Weg (nur der DB-Trigger greift)', () => {
    it('blockt einen internen patch am Trigger', async () => {
      const created = await createReference()

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (app.service('order-references') as any).patch(created._id, { refType: 'Split' }, internal),
      ).rejects.toThrow(/append-only/i)
    })

    it('blockt ein internes remove am Trigger', async () => {
      const created = await createReference()

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (app.service('order-references') as any).remove(created._id, internal),
      ).rejects.toThrow(/append-only/i)
    })

    it('blockt ein direktes UPDATE per Knex', async () => {
      const created = await createReference()
      const knex = app.get('sqliteClient')

      await expect(knex('order-references').where({ _id: created._id }).update({ refType: 'Split' })).rejects.toThrow(
        /append-only/i,
      )
    })

    it('blockt ein direktes DELETE per Knex', async () => {
      const created = await createReference()
      const knex = app.get('sqliteClient')

      await expect(knex('order-references').where({ _id: created._id }).del()).rejects.toThrow(/append-only/i)
    })
  })

  describe('Append-only — externer Weg', () => {
    const external = () =>
      ({
        provider: 'rest',
        authenticated: true,
        user: { _id: userId, role: 'tenant:owner', tenantId, locationId },
      }) as never

    it('laesst patch von aussen nicht zu', async () => {
      const created = await createReference()

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (app.service('order-references') as any).patch(created._id, { refType: 'Split' }, external()),
      ).rejects.toThrow()
    })

    it('laesst remove von aussen nicht zu', async () => {
      const created = await createReference()

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (app.service('order-references') as any).remove(created._id, external()),
      ).rejects.toThrow()
    })
  })

  describe('Abfragen', () => {
    it('findet Referenzen zum Ursprungsvorgang', async () => {
      const sourceOrderId = uuidv7()
      await createReference({ sourceOrderId })

      const found = (await app
        .service('order-references')
        .find({ ...internal, query: { sourceOrderId } } as never)) as { total: number }

      expect(found.total).toBe(1)
    })

    it('laesst find({ refType }) zu — 200 statt 400', async () => {
      // `orderReferenceQuerySchema` traegt `additionalProperties: false`: Was
      // nicht in `orderReferenceQueryProperties` gepickt ist, existiert fuer
      // den Query-Validator nicht und liefert 400.
      await expect(
        app.service('order-references').find({ ...internal, query: { refType: 'Storno' } } as never),
      ).resolves.toBeDefined()
    })
  })

  describe('Storno schreibt eine Referenz', () => {
    const lineItem = () => ({
      _id: uuidv7(),
      externalId: uuidv7(),
      productGroupExternalId: uuidv7(),
      name: 'Storno-Referenz-Testprodukt',
      amount: 1,
      price: 10,
      modifiers: [],
      recipeReferences: [],
      ingredientReferences: [],
      taxInside: 19,
      taxOutside: 7,
      topic: 'kitchen',
      bundleNumber: null,
    })

    it('legt beim Uebergang auf ABORTED genau eine Storno-Referenz an', async () => {
      const order = (await app.service('orders').create(
        {
          tenantId,
          locationId,
          status: 'active',
          orderChannel: 'pos',
          dineLocation: 'dine-in',
          lineItems: [lineItem()],
          isFinished: false,
          estimatedDuration: 0,
          remainingTime: 0,
          recordingDate: new Date().toISOString(),
        } as never,
        { ...internal, user: { _id: userId, tenantId, locationId } } as never,
      )) as { _id: string }

      onTestFinished(async () => {
        await app
          .service('orders')
          .remove(order._id, internal)
          .catch(() => undefined)
      })

      await app.service('orders').patch(order._id, { status: 'aborted' } as never, internal)

      const refs = (await app
        .service('order-references')
        .find({ ...internal, query: { sourceOrderId: order._id } } as never)) as {
        total: number
        data: { refType: string; targetOrderId?: string }[]
      }

      expect(refs.total).toBe(1)
      expect(refs.data[0].refType).toBe('Storno')
      expect(refs.data[0].targetOrderId ?? null).toBeNull()
    })

    it('schreibt KEINE Referenz bei einem Patch ohne Statuswechsel', async () => {
      const order = (await app.service('orders').create(
        {
          tenantId,
          locationId,
          status: 'active',
          orderChannel: 'pos',
          dineLocation: 'dine-in',
          lineItems: [lineItem()],
          isFinished: false,
          estimatedDuration: 0,
          remainingTime: 0,
          recordingDate: new Date().toISOString(),
        } as never,
        { ...internal, user: { _id: userId, tenantId, locationId } } as never,
      )) as { _id: string }

      onTestFinished(async () => {
        await app
          .service('orders')
          .remove(order._id, internal)
          .catch(() => undefined)
      })

      await app.service('orders').patch(order._id, { remainingTime: 5 } as never, internal)

      const refs = (await app
        .service('order-references')
        .find({ ...internal, query: { sourceOrderId: order._id } } as never)) as { total: number }

      expect(refs.total).toBe(0)
    })
  })
})
