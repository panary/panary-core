// Tenant-weite Stammdaten am Edge (#190): `locationId: null` bedeutet „gilt fuer jede
// Filiale des Mandanten" und ist die Voraussetzung fuer den Katalog-Rollout aus der Cloud
// (panary/panary-cloud#217).
//
// Bewusst ein Integrationstest gegen die VOLLE Hook-Kette (`provider: 'socketio'` erzwingt
// den externen Pfad) statt einer Unit-Spec des Hooks: Die Aenderung besteht aus zwei
// Haelften, die nur zusammen wirken — dem nullable `locationId` im Schema (sonst lehnt
// `validateData` den Datensatz ab) und `allowGlobalData: true` am Service (sonst filtert
// ihn der Read-Filter weg). Eine Hook-Spec mit gefaktem Context wuerde die erste Haelfte
// gar nicht beruehren und trotzdem gruen sein.
//
// Jede Sichtbarkeits-Behauptung hat eine Gegenprobe: Ein Test, der aus einem anderen Grund
// leer zurueckkommt (falscher Tenant, kaputte Query), wuerde sonst als „Filter wirkt"
// durchgehen.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { app } from '../../../src/app'

interface ProductRecord {
  _id: string
  locationId: string | null
}

type ProductsFindResult = { data?: ProductRecord[] } | ProductRecord[]

const idsOf = (result: ProductsFindResult): string[] =>
  (Array.isArray(result) ? result : (result.data ?? [])).map(p => p._id)

describe('Produkte am Edge — tenant-weite Stammdaten (locationId: null)', () => {
  const tenantId = uuidv7()
  const foreignTenantId = uuidv7()

  let ownLocationId: string
  let otherLocationId: string
  let foreignLocationId: string

  let ownProductId: string
  let otherLocationProductId: string
  let tenantWideProductId: string
  let foreignTenantWideProductId: string

  /** Mitarbeiter der eigenen Filiale — nicht privilegiert, also location-gescoped. */
  const staffParams = () =>
    ({
      provider: 'socketio',
      authenticated: true,
      user: {
        _id: uuidv7(),
        role: 'tenant:staff',
        tenantId,
        activeLocationId: ownLocationId,
      },
    }) as never

  /** Inhaber — die einzige Tenant-Rolle mit `products:MANAGE` (roles.matrix.ts). */
  const ownerParams = () =>
    ({
      provider: 'socketio',
      authenticated: true,
      user: {
        _id: uuidv7(),
        role: 'tenant:owner',
        tenantId,
        activeLocationId: ownLocationId,
      },
    }) as never

  const createLocation = async (name: string, tenant: string): Promise<string> => {
    const location = (await app.service('locations').create(
      {
        name,
        tenantId: tenant,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    return location._id
  }

  /** Interner Create — der Weg, auf dem der Sync-Pull Cloud-Datensaetze anlegt. */
  const createProduct = async (name: string, tenant: string, locationId: string | null): Promise<ProductRecord> =>
    (await app.service('products').create(
      {
        name,
        acronym: name.slice(0, 8),
        price: 1.5,
        taxInside: 19,
        taxOutside: 7,
        tenantId: tenant,
        locationId,
      } as never,
      { provider: undefined },
    )) as ProductRecord

  beforeAll(async () => {
    await app.setup()

    ownLocationId = await createLocation('Filiale Eins', tenantId)
    otherLocationId = await createLocation('Filiale Zwei', tenantId)
    foreignLocationId = await createLocation('Fremde Filiale', foreignTenantId)

    ownProductId = (await createProduct('Eigen', tenantId, ownLocationId))._id
    otherLocationProductId = (await createProduct('Nachbar', tenantId, otherLocationId))._id
    tenantWideProductId = (await createProduct('Geteilt', tenantId, null))._id
    foreignTenantWideProductId = (await createProduct('Fremd geteilt', foreignTenantId, null))._id
  })

  afterAll(async () => {
    await app.teardown()
  })

  it('legt ein Produkt mit locationId: null an — das Schema akzeptiert tenant-weit', async () => {
    const product = (await app.service('products').get(tenantWideProductId, { provider: undefined } as never)) as
      ProductRecord | undefined

    assert.ok(product, 'das tenant-weite Produkt wurde nicht angelegt')
    assert.strictEqual(
      product.locationId,
      null,
      'locationId muss null bleiben, nicht auf eine Filiale gestempelt werden',
    )
  })

  it('lehnt ein Produkt OHNE locationId weiterhin ab', async () => {
    // Der Pull-Apply laeuft ohne `user` und damit ohne Stempel: `required` im Data-Schema
    // ist dort die einzige Instanz, die einen defekten Cloud-Record laut ablehnt, statt
    // ihn still mit NULL zu schreiben (assert-stamp-fields.ts). Nullable heisst NICHT
    // optional — diese Grenze haelt die Aenderung aus #190 bewusst.
    await assert.rejects(
      () =>
        app
          .service('products')
          .create(
            { name: 'Ohne Filiale', acronym: 'OHNE', price: 1, taxInside: 19, taxOutside: 7, tenantId } as never,
            { provider: undefined },
          ),
      (err: unknown) => {
        // Die Feld-Angabe steckt in `error.data`, nicht in der Message („validation failed") —
        // ein Regex auf die Message wuerde jede beliebige Validierungsverletzung akzeptieren
        // und damit auch dann gruen bleiben, wenn locationId laengst optional geworden ist.
        const details =
          (err as { data?: Array<{ keyword?: string; params?: { missingProperty?: string } }> }).data ?? []
        return details.some(d => d.keyword === 'required' && d.params?.missingProperty === 'locationId')
      },
      'ein fehlendes locationId muss weiterhin als Pflichtfeld scheitern',
    )
  })

  it('zeigt dem Filial-Mitarbeiter die eigenen UND die tenant-weiten Produkte', async () => {
    const ids = idsOf(
      (await app
        .service('products')
        .find({ query: { $limit: 250 }, ...(staffParams() as object) } as never)) as ProductsFindResult,
    )

    assert.ok(ids.includes(ownProductId), 'das Produkt der eigenen Filiale fehlt')
    assert.ok(ids.includes(tenantWideProductId), 'das tenant-weite Produkt fehlt — allowGlobalData greift nicht')
  })

  it('zeigt ihm NICHT die Produkte der Nachbarfiliale (Gegenprobe zur Location-Isolation)', async () => {
    const ids = idsOf(
      (await app
        .service('products')
        .find({ query: { $limit: 250 }, ...(staffParams() as object) } as never)) as ProductsFindResult,
    )

    assert.ok(
      !ids.includes(otherLocationProductId),
      'die Filial-Isolation ist mit allowGlobalData aufgeweicht worden — das waere ein Datenleck zwischen Filialen',
    )
  })

  it('leckt keine tenant-weiten Produkte fremder Mandanten', async () => {
    const ids = idsOf(
      (await app
        .service('products')
        .find({ query: { $limit: 250 }, ...(staffParams() as object) } as never)) as ProductsFindResult,
    )

    assert.ok(
      !ids.includes(foreignTenantWideProductId),
      'locationId: null darf tenant-weit heissen, niemals mandantenuebergreifend',
    )
    assert.ok(foreignLocationId, 'Fixture-Selbstpruefung: die fremde Filiale wurde angelegt')
  })

  it('stempelt einen externen Create mit locationId: null auf die Filiale des Bedieners', async () => {
    // Bewusstes, per Spec gelocktes Verhalten des WRITE-Stempels: Tenant-weite Datensaetze
    // entstehen ausschliesslich in der Cloud und kommen per Sync — ein Edge-Client kann
    // sie nicht anlegen. Ohne diesen Test wuerde eine spaetere „Verbesserung" des Stempels
    // (`!item.locationId` → `item.locationId === undefined`) unbemerkt zur Rechteausweitung.
    const created = (await app
      .service('products')
      .create(
        { name: 'Extern', acronym: 'EXT', price: 2, taxInside: 19, taxOutside: 7, locationId: null } as never,
        ownerParams(),
      )) as ProductRecord

    assert.strictEqual(created.locationId, ownLocationId, 'ein externer Create muss filialgebunden bleiben')
  })
})
