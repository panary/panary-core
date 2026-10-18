import type { Knex } from 'knex'

// panary/panary-core#762 — Bestandsdaten-Heilung: Geraete-Schluessel von KDS und
// Tablets tragen die Rolle `device:pos-client` statt ihrer eigenen.
//
// Ursache: Der `role`-Resolver in `services/apikeys/apikeys.schema.ts` suchte das
// Geraet per `devices.get(apikey.deviceId)`. Der devices-Service ist aber mit
// `id: '_id'` registriert, `apikeys.deviceId` ist `devices.deviceId` — eine
// andere UUID. `get` scheiterte in jedem Produktionspfad (POST /devices,
// Pairing-Code-Redeem), ein leerer `catch` verschluckte es, und der Rueckfall
// vergab die breiteste Geraeterolle mit allen POS-Rechten (Orders, Storno,
// Rabatt, Kassensitzung …). Der Resolver ist korrigiert; diese Migration zieht
// die schon ausgestellten Schluessel nach.
//
// 🚨 Angefasst wird NUR die Kombination, die der Fehler erzeugt hat: Rolle
// `device:pos-client` an einem Geraet vom Typ `kds` bzw. `tablet`. Jede andere
// Rolle (auch eine ausdruecklich gesetzte) bleibt, ebenso Schluessel ohne
// Geraet und Geraete vom Typ `pos-counter`/`other`, fuer die `device:pos-client`
// die richtige Rolle ist.
//
// ⚠️ Rollen-Literale bewusst ohne Import aus `@panary/users/domain`: Migrationen
// werden als Assets einzeln mit `--bundle=false` transpiliert
// (tools/docker/Dockerfile.edge); ein Aufloesungsfehler fiele in `sqlite.ts`
// nur als Log auf. Die Kopplung an die Domain haelt der Test
// `test/migrations/fix-device-apikey-roles.spec.ts`.

export const ROLE_DEVICE_POS = 'device:pos-client'
export const ROLE_BY_DEVICE_TYPE: Readonly<Record<string, string>> = {
  kds: 'device:kds',
  tablet: 'device:tablet',
}

export async function up(knex: Knex): Promise<void> {
  const [hasApikeys, hasDevices] = await Promise.all([knex.schema.hasTable('apikeys'), knex.schema.hasTable('devices')])
  if (!hasApikeys || !hasDevices) return

  const now = new Date().toISOString()
  for (const [type, role] of Object.entries(ROLE_BY_DEVICE_TYPE)) {
    await knex('apikeys')
      .where('role', ROLE_DEVICE_POS)
      .whereIn('deviceId', knex('devices').select('deviceId').where('type', type))
      .update({ role, updatedAt: now })
  }
}

export async function down(): Promise<void> {
  // Bewusst nicht umkehrbar: Die alte Rolle war eine Rechteausweitung.
}
