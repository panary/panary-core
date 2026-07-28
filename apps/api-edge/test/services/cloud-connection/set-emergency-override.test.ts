// Integrationstest fuer die Custom-Method `setEmergencyOverride` — der
// Kontroll-Switch fuer den Notfall-Modus (ADR 0001). Laeuft gegen die echte
// Test-SQLite und die volle Hook-Kette.
//
// Der Kern ist die Koexistenz mit der Automatik: das Deaktivieren muss den
// Failure-Zaehler zuruecksetzen UND die Auto-Aktivierung stilllegen, sonst
// re-aktiviert der naechste fehlgeschlagene Heartbeat binnen Sekunden.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { PairingStatus } from '@panary/cloud-connection/domain'
import { app } from '../../../src/app'

type SetEmergencyOverrideService = {
  setEmergencyOverride: (
    data: { active: boolean; discardPendingOverrides?: boolean },
    params?: unknown,
  ) => Promise<{ emergencyOverride: boolean; pendingCount: number; conflictCount: number }>
}

describe('cloud-connection — setEmergencyOverride', () => {
  const created: string[] = []

  beforeAll(async () => {
    await app.setup()
  })

  // Die Methode waehlt gezielt die CONNECTED-Verbindung. Bleiben Records aus
  // vorherigen Tests (oder vorherigen Laeufen — die Test-SQLite ist persistent)
  // stehen, patcht sie eine fremde Zeile bzw. zaehlt fremde Overrides.
  beforeEach(async () => {
    const knex = app.get('sqliteClient') as any
    await knex.table('cloud-connection').del()
    await knex.table('pending-local-overrides').del()
    created.length = 0
  })

  afterAll(async () => {
    const knex = app.get('sqliteClient') as any
    await knex.table('cloud-connection').del()
    await knex.table('pending-local-overrides').del()
  })

  const service = () => app.service('cloud-connection') as unknown as SetEmergencyOverrideService

  /** Die tenantId wird mit zurueckgegeben: die Override-Zeilen muessen im
   *  selben Tenant liegen, sonst sieht das Repository sie nicht. */
  let seededTenantId = ''

  async function seedConnection(overrides: Record<string, unknown> = {}): Promise<string> {
    const id = uuidv7()
    const knex = app.get('sqliteClient') as any
    seededTenantId = (overrides['tenantId'] as string) ?? uuidv7()
    await knex.table('cloud-connection').insert({
      _id: id,
      tenantId: seededTenantId,
      cloudUrl: 'https://cloud.example.test',
      pairingStatus: PairingStatus.CONNECTED,
      syncEnabled: 1,
      consecutiveHeartbeatFailures: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    })
    created.push(id)
    return id
  }

  async function readConnection(id: string): Promise<Record<string, unknown>> {
    const knex = app.get('sqliteClient') as any
    return knex.table('cloud-connection').where({ _id: id }).first()
  }

  it('registriert die Custom-Method auf dem Service-Proxy', () => {
    assert.strictEqual(typeof service().setEmergencyOverride, 'function')
  })

  it('aktiviert manuell und markiert die Quelle als MANUAL', async () => {
    const id = await seedConnection()

    const result = await service().setEmergencyOverride({ active: true }, { provider: undefined })

    assert.strictEqual(result.emergencyOverride, true)
    const row = await readConnection(id)
    assert.ok(row['emergencyOverride'])
    assert.strictEqual(row['emergencyOverrideSource'], 'MANUAL')
    assert.ok(row['emergencyOverrideSince'])
    assert.strictEqual(row['emergencyOverrideSuppressedUntil'], null)
  })

  it('setzt beim Beenden Zaehler zurueck und legt die Automatik stumm', async () => {
    const id = await seedConnection({
      emergencyOverride: true,
      emergencyOverrideSource: 'AUTO',
      emergencyOverrideSince: new Date().toISOString(),
    })

    const result = await service().setEmergencyOverride({ active: false }, { provider: undefined })

    assert.strictEqual(result.emergencyOverride, false)
    const row = await readConnection(id)
    assert.ok(!row['emergencyOverride'])
    assert.strictEqual(row['emergencyOverrideSince'], null)
    assert.strictEqual(row['emergencyOverrideSource'], null)
    // Ohne diese beiden waere der Schalter wirkungslos.
    assert.strictEqual(row['consecutiveHeartbeatFailures'], 0)
    assert.ok(
      Date.parse(row['emergencyOverrideSuppressedUntil'] as string) > Date.now(),
      'Auto-Aktivierung muss voruebergehend stillgelegt sein',
    )
  })

  it('lehnt einen fehlenden active-Wert ab', async () => {
    await seedConnection()

    await assert.rejects(
      () => service().setEmergencyOverride({} as { active: boolean }, { provider: undefined }),
      /active/,
    )
  })

  it('lehnt den Aufruf ab, wenn der Edge nicht gepairt ist', async () => {
    await seedConnection({ pairingStatus: PairingStatus.DISCONNECTED })

    await assert.rejects(
      () => service().setEmergencyOverride({ active: true }, { provider: undefined }),
      /gepairt/,
    )
  })

  it('meldet die Anzahl gepufferter Overrides zurueck', async () => {
    await seedConnection()
    const knex = app.get('sqliteClient') as any
    const now = new Date().toISOString()
    const row = (status: string) => ({
      _id: uuidv7(),
      tenantId: seededTenantId,
      locationId: uuidv7(),
      tableName: 'locations',
      recordId: uuidv7(),
      fieldPath: 'printSettings.printers/p-1',
      oldValueJson: 'null',
      newValueJson: 'null',
      changedAt: now,
      status,
      createdAt: now,
      updatedAt: now,
    })
    await knex.table('pending-local-overrides').insert([row('PENDING_RECONCILE'), row('CONFLICT')])

    const result = await service().setEmergencyOverride({ active: false }, { provider: undefined })

    // „Beenden" verwirft nichts: die Eintraege werden beim naechsten
    // Cloud-Kontakt regulaer abgeglichen (Loeschen wuerde die lokalen Werte
    // NICHT zuruecksetzen, nur die Audit-Spur vernichten).
    assert.strictEqual(result.pendingCount, 1)
    assert.strictEqual(result.conflictCount, 1)
    assert.strictEqual(
      (await knex.table('pending-local-overrides').select()).length,
      2,
      'Beenden darf die gepufferten Overrides nicht loeschen',
    )
  })

  it('verwirft die gepufferten Overrides nur auf ausdrueckliche Anweisung', async () => {
    await seedConnection()
    const knex = app.get('sqliteClient') as any
    const now = new Date().toISOString()
    await knex.table('pending-local-overrides').insert({
      _id: uuidv7(),
      tenantId: seededTenantId,
      locationId: uuidv7(),
      tableName: 'locations',
      recordId: uuidv7(),
      fieldPath: 'printSettings.maxNameCharacters',
      oldValueJson: '42',
      newValueJson: '48',
      changedAt: now,
      status: 'PENDING_RECONCILE',
      createdAt: now,
      updatedAt: now,
    })

    await service().setEmergencyOverride(
      { active: false, discardPendingOverrides: true },
      { provider: undefined },
    )

    assert.strictEqual((await knex.table('pending-local-overrides').select()).length, 0)
  })
})
