// Produkte und Produktgruppen am gepairten Edge sind read-only (panary/panary-core#607).
//
// Beide sind Master-Daten mit Cloud→Edge-Pull, aber ohne Edge→Cloud-Push: Live gepusht wird
// nur `SyncableTransactionService` (sync-outbox-recorder.hook.ts). Eine Produktänderung am
// gepairten Edge wirkte deshalb an der Kasse, erreichte die Cloud nie und wurde beim naechsten
// Pull des Produkts still ueberschrieben — beobachtet am Edge „Dahlerstraße" im Sichttest
// panary/panary-cloud#670.
//
// Bewusst ein Integrationstest gegen die VOLLE Hook-Kette: Die Hook-Logik selbst deckt
// `cloud-managed.hook.spec.ts` ab. Was hier fehlte, war die Registrierung am Service — und die
// sieht eine Spec mit gefaktem Context nicht.
//
// Jede Sperre hat eine Gegenprobe: Ohne Pairing muss derselbe Write durchgehen, und der interne
// Pfad (`provider: undefined`, so schreibt der Sync-Pull) bleibt auch gepairt offen. Sonst
// ginge ein Test gruen, der aus einem anderen Grund ablehnt (Rechte, Validierung).
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { PairingStatus } from '@panary/cloud-connection/domain'
import { app } from '../../../src/app'

interface StoredRecord {
  _id: string
  name: string
}

const isCloudManaged = (err: unknown): boolean =>
  (err as { code?: number; data?: { code?: string } }).code === 403 &&
  (err as { data?: { code?: string } }).data?.code === 'CLOUD_MANAGED'

describe('Produkte und Produktgruppen am gepairten Edge — cloudManaged (#607)', () => {
  const tenantId = uuidv7()
  let locationId: string

  /** Inhaber — die Tenant-Rolle mit `products:MANAGE` und `product-groups:MANAGE`. */
  const ownerParams = () =>
    ({
      provider: 'socketio',
      authenticated: true,
      user: { _id: uuidv7(), role: 'tenant:owner', tenantId, activeLocationId: locationId },
    }) as never

  const knex = () => app.get('sqliteClient') as any

  const pair = async (): Promise<void> => {
    await knex().table('cloud-connection').insert({
      _id: uuidv7(),
      tenantId,
      cloudUrl: 'https://cloud.example.test',
      pairingStatus: PairingStatus.CONNECTED,
      syncEnabled: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  const unpair = async (): Promise<void> => {
    await knex().table('cloud-connection').del()
  }

  /** Interner Create — der Weg, auf dem der Sync-Pull Cloud-Datensaetze anlegt. */
  const seedProduct = async (name: string): Promise<StoredRecord> =>
    (await app
      .service('products')
      .create(
        { name, acronym: name.slice(0, 8), price: 1.5, taxInside: 19, taxOutside: 7, tenantId, locationId } as never,
        { provider: undefined },
      )) as StoredRecord

  const seedGroup = async (name: string): Promise<StoredRecord> =>
    (await app.service('product-groups').create({ name, color: '#336699', index: 0, tenantId, locationId } as never, {
      provider: undefined,
    })) as StoredRecord

  const storedName = async (table: string, id: string): Promise<string | undefined> =>
    ((await knex().table(table).where({ _id: id }).first()) as StoredRecord | undefined)?.name

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Filiale #607',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    locationId = location._id
  })

  // Die Test-SQLite ist persistent und wird von allen Dateien geteilt (vitest.config.mts):
  // Eine stehengebliebene CONNECTED-Zeile sperrte jeder spaeteren Suite die Edge-Writes.
  beforeEach(unpair)
  afterAll(async () => {
    await unpair()
    await app.teardown()
  })

  describe('products', () => {
    it('lehnt einen externen Patch bei aktivem Pairing mit CLOUD_MANAGED ab und laesst den Datensatz stehen', async () => {
      const product = await seedProduct('Original')
      await pair()

      await assert.rejects(
        () => app.service('products').patch(product._id, { name: 'Am Edge umbenannt' } as never, ownerParams()),
        isCloudManaged,
      )
      assert.strictEqual(await storedName('products', product._id), 'Original')
    })

    it('lehnt externen Create und Remove bei aktivem Pairing ab', async () => {
      const product = await seedProduct('Bleibt')
      await pair()

      await assert.rejects(
        () =>
          app
            .service('products')
            .create(
              { name: 'Neu am Edge', acronym: 'NEU', price: 2, taxInside: 19, taxOutside: 7, locationId } as never,
              ownerParams(),
            ),
        isCloudManaged,
      )
      await assert.rejects(() => app.service('products').remove(product._id, ownerParams()), isCloudManaged)
      assert.strictEqual(await storedName('products', product._id), 'Bleibt')
    })

    it('laesst denselben externen Patch ohne Pairing durch (Gegenprobe: Rechte und Schema tragen)', async () => {
      const product = await seedProduct('Standalone')

      await app.service('products').patch(product._id, { name: 'Standalone geaendert' } as never, ownerParams())

      assert.strictEqual(await storedName('products', product._id), 'Standalone geaendert')
    })

    it('laesst den internen Pfad des Sync-Pulls auch gepairt durch', async () => {
      const product = await seedProduct('Vor dem Pull')
      await pair()

      await app.service('products').patch(product._id, { name: 'Aus der Cloud' } as never, { provider: undefined })

      assert.strictEqual(await storedName('products', product._id), 'Aus der Cloud')
    })

    it('laesst Reads auch gepairt durch', async () => {
      const product = await seedProduct('Lesbar')
      await pair()

      const read = (await app.service('products').get(product._id, ownerParams())) as StoredRecord

      assert.strictEqual(read.name, 'Lesbar')
    })
  })

  describe('product-groups', () => {
    it('lehnt externe Writes bei aktivem Pairing mit CLOUD_MANAGED ab und laesst den Datensatz stehen', async () => {
      const group = await seedGroup('Getraenke')
      await pair()

      await assert.rejects(
        () => app.service('product-groups').patch(group._id, { name: 'Am Edge umbenannt' } as never, ownerParams()),
        isCloudManaged,
      )
      await assert.rejects(
        () =>
          app
            .service('product-groups')
            .create({ name: 'Neu am Edge', color: '#000000', index: 1, locationId } as never, ownerParams()),
        isCloudManaged,
      )
      await assert.rejects(() => app.service('product-groups').remove(group._id, ownerParams()), isCloudManaged)
      assert.strictEqual(await storedName('product-groups', group._id), 'Getraenke')
    })

    it('laesst denselben externen Patch ohne Pairing durch (Gegenprobe)', async () => {
      const group = await seedGroup('Snacks')

      await app.service('product-groups').patch(group._id, { name: 'Snacks geaendert' } as never, ownerParams())

      assert.strictEqual(await storedName('product-groups', group._id), 'Snacks geaendert')
    })

    it('laesst den internen Pfad des Sync-Pulls auch gepairt durch', async () => {
      const group = await seedGroup('Vor dem Pull')
      await pair()

      await app.service('product-groups').patch(group._id, { name: 'Aus der Cloud' } as never, { provider: undefined })

      assert.strictEqual(await storedName('product-groups', group._id), 'Aus der Cloud')
    })
  })
})
