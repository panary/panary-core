// Edge-authorize-Hook-Tests (Stufe 3.2) — sicherheitskritisch.
//
// Der Hook setzt Hybrid-RBAC durch: Rolle (Matrix) ODER additiver Pro-User-
// Grant via hasEffectivePermission (@panary/users/domain) — dieselbe Quelle
// der Wahrheit wie der Cloud-Hook. Gelockt werden:
//  - Matrix-Fälle (Rolle erlaubt / verbietet)
//  - Grant-Fälle (grant:<resource>:<action> im user.permissions-Array)
//  - Zeiterfassungs-Sonderfall (CAN_CLOCK_IN statt users:UPDATE)
//  - MANAGE-only-Fallback für unbekannte Custom-Methods (kein stilles READ mehr)
//  - Wegfall der SYSTEM-Wildcard (Cloud-Semantik)
//  - PLATFORM_OWNER-Bypass + interner Call-Bypass
//  - die komplette Edge-Custom-Method-Tabelle (Rolle × Methode)

import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@panary/shared-common'
import { UserSystemRole } from '@panary/users/domain'
import { authorize } from './authorize.hook'

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

interface MockUser {
  _id?: string
  role?: string
  tenantId?: string
  permissions?: unknown
}

interface BuildContextArgs {
  path: string
  method: string
  user?: MockUser
  provider?: string | undefined
}

const buildContext = (args: BuildContextArgs) => ({
  path: args.path,
  method: args.method,
  params: {
    provider: 'provider' in args ? args.provider : 'rest',
    user: args.user,
  },
})

const run = async (args: BuildContextArgs) => {
  const next = vi.fn(async () => undefined)
  await authorize()(buildContext(args) as never, next)
  return next
}

const expectAllowed = async (args: BuildContextArgs) => {
  const next = await run(args)
  expect(next).toHaveBeenCalledOnce()
}

const expectForbidden = async (args: BuildContextArgs) => {
  await expect(run(args)).rejects.toMatchObject({
    name: 'Forbidden',
    data: { code: AppError.AUTH_NO_PERMISSION },
  })
}

const staff: MockUser = { _id: 'u-staff', role: UserSystemRole.TENANT_STAFF, tenantId: 't1', permissions: [] }
const manager: MockUser = { _id: 'u-mgr', role: UserSystemRole.TENANT_MANAGER, tenantId: 't1' }
const owner: MockUser = { _id: 'u-owner', role: UserSystemRole.TENANT_OWNER, tenantId: 't1' }
const technician: MockUser = { _id: 'u-tech', role: UserSystemRole.TENANT_TECHNICIAN, tenantId: 't1' }
const platformOwner: MockUser = { _id: 'u-po', role: UserSystemRole.PLATFORM_OWNER }
// Geräte-User kommen am Edge als virtuelle User aus allowApiKey (ohne permissions-Feld)
const devicePos: MockUser = { _id: 'device:pos-1', role: UserSystemRole.DEVICE_POS, tenantId: 't1' }
const deviceTablet: MockUser = { _id: 'device:tab-1', role: UserSystemRole.DEVICE_TABLET, tenantId: 't1' }
const deviceKds: MockUser = { _id: 'device:kds-1', role: UserSystemRole.DEVICE_KDS, tenantId: 't1' }
const deviceKiosk: MockUser = { _id: 'device:kiosk-1', role: UserSystemRole.DEVICE_KIOSK, tenantId: 't1' }

describe('authorize() — Bypässe', () => {
  it('interner Aufruf (kein provider): keine Prüfung, next läuft', async () => {
    await expectAllowed({ path: 'users', method: 'remove', provider: undefined })
  })

  it('ohne user: Forbidden mit TENANT_MISMATCH-Code', async () => {
    await expect(run({ path: 'products', method: 'find' })).rejects.toMatchObject({
      name: 'Forbidden',
      data: { code: AppError.TENANT_MISMATCH },
    })
  })

  it('PLATFORM_OWNER: vollständiger Bypass — auch für unbekannte Custom-Methods', async () => {
    await expectAllowed({ path: 'users', method: 'remove', user: platformOwner })
    await expectAllowed({ path: 'irgendwas', method: 'unbekannteMethode', user: platformOwner })
  })
})

describe('authorize() — Matrix-Fälle (Rolle)', () => {
  it('TENANT_STAFF darf products lesen, aber nicht anlegen', async () => {
    await expectAllowed({ path: 'products', method: 'find', user: staff })
    await expectForbidden({ path: 'products', method: 'create', user: staff })
  })

  it('TENANT_OWNER darf users verwalten (MANAGE deckt remove)', async () => {
    await expectAllowed({ path: 'users', method: 'remove', user: owner })
  })

  it('DEVICE_KIOSK darf keine users lesen', async () => {
    await expectForbidden({ path: 'users', method: 'find', user: deviceKiosk })
  })

  it('unbekannte Rolle: 403 statt Crash', async () => {
    await expectForbidden({ path: 'products', method: 'find', user: { _id: 'x', role: 'bogus:role' } })
  })
})

describe('authorize() — Grant-Fälle (Hybrid-RBAC)', () => {
  it('TENANT_STAFF ohne Grant: incoming-goods create → 403', async () => {
    await expectForbidden({ path: 'incoming-goods', method: 'create', user: staff })
  })

  it('TENANT_STAFF mit grant:incoming-goods:manage: create → durch', async () => {
    await expectAllowed({
      path: 'incoming-goods',
      method: 'create',
      user: { ...staff, permissions: ['grant:incoming-goods:manage'] },
    })
  })

  it('permissions als roher JSON-String (SQLite): Grant greift trotzdem', async () => {
    await expectAllowed({
      path: 'incoming-goods',
      method: 'create',
      user: { ...staff, permissions: '["grant:incoming-goods:manage"]' },
    })
  })

  it('kaputter permissions-String: kein Crash, kein Zugriff', async () => {
    await expectForbidden({
      path: 'incoming-goods',
      method: 'create',
      user: { ...staff, permissions: '{nicht-json' },
    })
  })

  it('unbekannter/getippter Grant gewährt nie Zugriff', async () => {
    await expectForbidden({
      path: 'incoming-goods',
      method: 'create',
      user: { ...staff, permissions: ['grant:bogus:manage', 'can_discount'] },
    })
  })
})

describe('authorize() — unbekannte Custom-Methods (kein stilles READ mehr)', () => {
  it('TENANT_STAFF mit orders:READ+CREATE: unbekannte Methode → 403', async () => {
    await expectForbidden({ path: 'orders', method: 'reticulate', user: staff })
  })

  it('TENANT_OWNER mit users:MANAGE: unbekannte Methode → durch (MANAGE-Fallback)', async () => {
    await expectAllowed({ path: 'users', method: 'reticulate', user: owner })
  })
})

describe('authorize() — SYSTEM ist keine Wildcard mehr (Cloud-Semantik)', () => {
  it('TENANT_TECHNICIAN erreicht fiscal-counters über den expliziten Matrix-Eintrag', async () => {
    await expectAllowed({ path: 'fiscal-counters', method: 'find', user: technician })
  })

  it('TENANT_TECHNICIAN erreicht log-export + organizations explizit (vorher Wildcard)', async () => {
    await expectAllowed({ path: 'log-export', method: 'find', user: technician })
    await expectAllowed({ path: 'organizations', method: 'find', user: technician })
  })

  it('TENANT_TECHNICIAN kommt NICHT mehr überall durch (Wildcard entfernt)', async () => {
    await expectForbidden({ path: 'nicht-existierender-service', method: 'find', user: technician })
    // receipts: Wildcard erlaubte vorher externes remove — jetzt nur READ+UPDATE
    await expectForbidden({ path: 'receipts', method: 'remove', user: technician })
  })
})

describe('authorize() — Zeiterfassung (CAN_CLOCK_IN-Alternative)', () => {
  it.each(['checkin', 'checkout', 'startBreak', 'endBreak'])(
    'DEVICE_POS darf users.%s über die CAN_CLOCK_IN-Ability (kein users:UPDATE)',
    async method => {
      await expectAllowed({ path: 'users', method, user: devicePos })
    },
  )

  it('DEVICE_TABLET darf checkin (Ability), DEVICE_KIOSK/KDS nicht', async () => {
    await expectAllowed({ path: 'users', method: 'checkin', user: deviceTablet })
    await expectForbidden({ path: 'users', method: 'checkin', user: deviceKiosk })
    await expectForbidden({ path: 'users', method: 'checkin', user: deviceKds })
  })

  it('DEVICE_POS darf trotz Ability KEINEN regulären users-Patch', async () => {
    await expectForbidden({ path: 'users', method: 'patch', user: devicePos })
  })

  it('TENANT_STAFF/MANAGER stempeln über users:UPDATE (ohne Ability)', async () => {
    await expectAllowed({ path: 'users', method: 'checkin', user: staff })
    await expectAllowed({ path: 'users', method: 'checkout', user: manager })
  })

  it('can_clock_in im user.permissions-Array genügt (z.B. Sonder-Gerät)', async () => {
    await expectAllowed({
      path: 'users',
      method: 'checkin',
      user: { ...deviceKds, permissions: ['can_clock_in'] },
    })
  })

  it('CAN_CLOCK_IN wirkt NUR auf die Zeiterfassungs-Methoden des users-Service', async () => {
    // gleiche Methode auf anderer Ressource (products: POS hat nur READ)
    // → kein Ability-Durchgriff, checkin→UPDATE wird von der Matrix abgelehnt
    await expectForbidden({ path: 'products', method: 'checkin', user: devicePos })
  })
})

describe('authorize() — Edge-Custom-Method-Tabelle (Rolle × Methode)', () => {
  it('users.verifyPin (READ): POS/Tablet/Tenant-Rollen ja, Kiosk/KDS nein', async () => {
    await expectAllowed({ path: 'users', method: 'verifyPin', user: devicePos })
    await expectAllowed({ path: 'users', method: 'verifyPin', user: deviceTablet })
    await expectAllowed({ path: 'users', method: 'verifyPin', user: staff })
    await expectForbidden({ path: 'users', method: 'verifyPin', user: deviceKiosk })
    await expectForbidden({ path: 'users', method: 'verifyPin', user: deviceKds })
  })

  it('cash-sessions.openAuthorized (CREATE): Staff/POS/Manager ja, Tablet/Kiosk nein', async () => {
    await expectAllowed({ path: 'cash-sessions', method: 'openAuthorized', user: staff })
    await expectAllowed({ path: 'cash-sessions', method: 'openAuthorized', user: devicePos })
    await expectAllowed({ path: 'cash-sessions', method: 'openAuthorized', user: manager })
    await expectForbidden({ path: 'cash-sessions', method: 'openAuthorized', user: deviceTablet })
    await expectForbidden({ path: 'cash-sessions', method: 'openAuthorized', user: deviceKiosk })
  })

  it('businessdays.openDay/closeDay/refreshClosingStatus: POS + Manager+ ja, Staff nein', async () => {
    await expectAllowed({ path: 'businessdays', method: 'openDay', user: devicePos })
    await expectAllowed({ path: 'businessdays', method: 'closeDay', user: devicePos })
    await expectAllowed({ path: 'businessdays', method: 'refreshClosingStatus', user: manager })
    await expectAllowed({ path: 'businessdays', method: 'closeDay', user: owner })
    await expectForbidden({ path: 'businessdays', method: 'openDay', user: staff })
    await expectForbidden({ path: 'businessdays', method: 'closeDay', user: staff })
  })

  it('pre-orders.convert (UPDATE): Staff/POS ja, Kiosk nein', async () => {
    await expectAllowed({ path: 'pre-orders', method: 'convert', user: staff })
    await expectAllowed({ path: 'pre-orders', method: 'convert', user: devicePos })
    await expectForbidden({ path: 'pre-orders', method: 'convert', user: deviceKiosk })
  })

  it('sync-outbox.reEnqueue (UPDATE): Owner/Manager/Technician ja, Staff/POS nein', async () => {
    await expectAllowed({ path: 'sync-outbox', method: 'reEnqueue', user: owner })
    await expectAllowed({ path: 'sync-outbox', method: 'reEnqueue', user: manager })
    await expectAllowed({ path: 'sync-outbox', method: 'reEnqueue', user: technician })
    await expectForbidden({ path: 'sync-outbox', method: 'reEnqueue', user: staff })
    await expectForbidden({ path: 'sync-outbox', method: 'reEnqueue', user: devicePos })
  })

  it('cloud-connection preflight/startBootstrap/syncNow: Owner/Technician ja, Manager/POS nein', async () => {
    for (const method of ['preflight', 'startBootstrap', 'syncNow']) {
      await expectAllowed({ path: 'cloud-connection', method, user: owner })
      await expectAllowed({ path: 'cloud-connection', method, user: technician })
      await expectForbidden({ path: 'cloud-connection', method, user: manager })
      await expectForbidden({ path: 'cloud-connection', method, user: devicePos })
    }
  })
})
