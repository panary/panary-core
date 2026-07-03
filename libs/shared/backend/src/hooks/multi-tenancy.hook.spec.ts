// Multi-Tenancy-Hook-Tests (Edge) — sicherheitskritisch.
//
// Der Edge-Hook unterscheidet sich bewusst vom Cloud-Hook:
//  - Bypass haengt am USER (kein user = interner Call), nicht am provider
//  - platform:*-Rollen bekommen READ-Bypass, aber WRITE-Stamping via stampEdgeDefaults
//    (inkl. Fallback-Lookup der einzigen Location am Edge)
//  - READ-Scoping greift auch fuer update/patch (Single-Patch wird mitgescopt)
//
// Eine Regression im Stamping oder Scoping waere ein direkter
// Cross-Tenant-Datenleck-Vektor. Hier werden die Verzweigungen gelockt.

import { describe, expect, it, vi } from 'vitest'
import { UserSystemRole } from '@panary/users/domain'
import { multiTenancy, MultiTenancyOptions } from './multi-tenancy.hook'

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

interface MockUser {
  _id?: string
  role?: string
  tenantId?: string
  locationId?: string | null
}

interface BuildContextArgs {
  method: 'find' | 'get' | 'create' | 'update' | 'patch' | 'remove'
  path?: string
  user?: MockUser
  data?: Record<string, unknown> | undefined
  query?: Record<string, unknown> | undefined
  // Ergebnis des locations-Fallback-Lookups (paginierte Form wie der echte Service)
  locationsResult?: { data: Array<{ _id: string; tenantId: string }> }
}

interface TestContext {
  app: { service: (path: string) => unknown }
  path: string
  method: string
  params: { user?: MockUser; query?: Record<string, unknown> }
  data?: Record<string, unknown>
}

const buildContext = (args: BuildContextArgs) => {
  const locationsService = {
    find: vi.fn().mockResolvedValue(args.locationsResult ?? { data: [] }),
  }
  const ctx: TestContext = {
    app: { service: (path: string) => (path === 'locations' ? locationsService : undefined) },
    path: args.path ?? 'products',
    method: args.method,
    params: { user: args.user, query: args.query },
    data: args.data,
  }
  return { ctx, locationsService }
}

const run = async (ctx: TestContext, options?: MultiTenancyOptions) => {
  const next = vi.fn(async () => undefined)
  await multiTenancy(options)(ctx as never, next)
  return next
}

const staffUser: MockUser = { _id: 'u1', role: UserSystemRole.TENANT_STAFF, tenantId: 't1', locationId: 'loc-1' }
const ownerUser: MockUser = { _id: 'u2', role: UserSystemRole.TENANT_OWNER, tenantId: 't1', locationId: 'loc-1' }

describe('multiTenancy() — interner Aufruf (kein User)', () => {
  it('ohne user: kein Stamp, kein Filter, next wird aufgerufen', async () => {
    const { ctx } = buildContext({ method: 'create', data: { name: 'Brot' } })
    const next = await run(ctx)
    expect(ctx.data?.tenantId).toBeUndefined()
    expect(ctx.params.query).toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
  })

  it('ohne user auf find: query bleibt unangetastet', async () => {
    const { ctx } = buildContext({ method: 'find', query: { name: 'Brot' } })
    await run(ctx)
    expect(ctx.params.query).toEqual({ name: 'Brot' })
  })
})

describe('multiTenancy() — WRITE-Stamping (create/update/patch)', () => {
  it('create stempelt tenantId vom User', async () => {
    const { ctx } = buildContext({ method: 'create', user: staffUser, data: { name: 'Brot' } })
    const next = await run(ctx)
    expect(ctx.data?.tenantId).toBe('t1')
    expect(next).toHaveBeenCalledOnce()
  })

  it('fremde Client-tenantId in data wird ueberschrieben (Cross-Tenant-Stamp-Schutz)', async () => {
    const { ctx } = buildContext({ method: 'create', user: staffUser, data: { name: 'Brot', tenantId: 'FREMD' } })
    await run(ctx)
    expect(ctx.data?.tenantId).toBe('t1')
  })

  it('update und patch stempeln tenantId ebenfalls', async () => {
    for (const method of ['update', 'patch'] as const) {
      const { ctx } = buildContext({ method, user: staffUser, data: { tenantId: 'FREMD' } })
      await run(ctx)
      expect(ctx.data?.tenantId, `method=${method}`).toBe('t1')
    }
  })
})

describe('multiTenancy() — locationId-Stamping (isolateLocation)', () => {
  it('isolateLocation=true: fehlende locationId wird vom User gestempelt', async () => {
    const { ctx } = buildContext({ method: 'create', user: staffUser, data: { name: 'Brot' } })
    await run(ctx, { isolateLocation: true })
    expect(ctx.data?.locationId).toBe('loc-1')
  })

  it('explizit gesetzte locationId bleibt erhalten (Owner darf Filiale waehlen)', async () => {
    const { ctx } = buildContext({ method: 'create', user: ownerUser, data: { locationId: 'loc-9' } })
    await run(ctx, { isolateLocation: true })
    expect(ctx.data?.locationId).toBe('loc-9')
  })

  // REGRESSIONSANKER (Ist-Verhalten, kein Soll): `if (!data.locationId)` ist truthy-basiert —
  // explizites locationId=null wird mit user.locationId ueberstempelt. Wer null als
  // "global/tenant-weit" senden will, laeuft in diese Fussangel (siehe Memory
  // feedback_multitenancy_stamps_explicit_null_location). Aenderung hier = bewusste Entscheidung.
  it('locationId=null wird aktuell ueberstempelt (Ist-Verhalten gelockt)', async () => {
    const { ctx } = buildContext({ method: 'create', user: staffUser, data: { locationId: null } })
    await run(ctx, { isolateLocation: true })
    expect(ctx.data?.locationId).toBe('loc-1')
  })

  // REGRESSIONSANKER (Ist-Verhalten): anders als im Cloud-Hook wird am Edge AUCH der
  // Leerstring ('' = "alle Filialen"-Semantik) ueberstempelt, weil !'' ebenfalls true ist.
  it("locationId='' wird aktuell ebenfalls ueberstempelt (Edge-Abweichung zur Cloud, gelockt)", async () => {
    const { ctx } = buildContext({ method: 'create', user: staffUser, data: { locationId: '' } })
    await run(ctx, { isolateLocation: true })
    expect(ctx.data?.locationId).toBe('loc-1')
  })

  it('isolateLocation=false (Default): keine locationId gestempelt', async () => {
    const { ctx } = buildContext({ method: 'create', user: staffUser, data: { name: 'Brot' } })
    await run(ctx)
    expect(ctx.data?.locationId).toBeUndefined()
  })

  it('User ohne locationId: kein Stamp trotz isolateLocation=true', async () => {
    const { ctx } = buildContext({
      method: 'create',
      user: { _id: 'u3', role: UserSystemRole.TENANT_OWNER, tenantId: 't1' },
      data: { name: 'Brot' },
    })
    await run(ctx, { isolateLocation: true })
    expect(ctx.data?.locationId).toBeUndefined()
  })
})

describe('multiTenancy() — READ-Scoping (find/get/remove)', () => {
  it('setzt query.tenantId fuer find, get und remove', async () => {
    for (const method of ['find', 'get', 'remove'] as const) {
      const { ctx } = buildContext({ method, user: staffUser, query: {} })
      await run(ctx)
      expect(ctx.params.query?.['tenantId'], `method=${method}`).toBe('t1')
    }
  })

  it('neutralisiert Client-Injection: fremde query.tenantId wird ueberschrieben', async () => {
    const { ctx } = buildContext({ method: 'find', user: staffUser, query: { tenantId: 'FREMD' } })
    await run(ctx)
    expect(ctx.params.query?.['tenantId']).toBe('t1')
  })

  it('Client-$or mit fremder tenantId bleibt stehen, wird aber durch top-level tenantId UND-verknuepft', async () => {
    // Ohne isolateLocation wird das $or nicht ersetzt — das harte top-level tenantId
    // entschaerft es: fremde Records matchen nie, egal was im $or steht.
    const { ctx } = buildContext({
      method: 'find',
      user: staffUser,
      query: { $or: [{ tenantId: 'FREMD' }, { _id: 'x' }] },
    })
    await run(ctx)
    expect(ctx.params.query?.['tenantId']).toBe('t1')
    expect(ctx.params.query?.['$or']).toEqual([{ tenantId: 'FREMD' }, { _id: 'x' }])
  })

  it('update/patch werden ebenfalls query-gescopt (Edge: auch Single-Patch)', async () => {
    for (const method of ['update', 'patch'] as const) {
      const { ctx } = buildContext({ method, user: staffUser, data: {}, query: {} })
      await run(ctx)
      expect(ctx.params.query?.['tenantId'], `method=${method}`).toBe('t1')
    }
  })

  it('fehlende query wird angelegt und gescopt', async () => {
    const { ctx } = buildContext({ method: 'find', user: staffUser })
    await run(ctx)
    expect(ctx.params.query?.['tenantId']).toBe('t1')
  })
})

describe('multiTenancy() — Location-Isolation (READ)', () => {
  it('tenant:staff sieht nur die eigene Filiale (allowGlobalData=false)', async () => {
    const { ctx } = buildContext({ method: 'find', user: staffUser, query: {} })
    await run(ctx, { isolateLocation: true, allowGlobalData: false })
    expect(ctx.params.query?.['locationId']).toBe('loc-1')
    expect(ctx.params.query?.['$or']).toBeUndefined()
  })

  it('allowGlobalData=true: $or aus eigener Filiale + globalen Daten (locationId null)', async () => {
    const { ctx } = buildContext({ method: 'find', user: staffUser, query: {} })
    await run(ctx, { isolateLocation: true, allowGlobalData: true })
    expect(ctx.params.query?.['$or']).toEqual([{ locationId: 'loc-1' }, { locationId: null }])
    expect(ctx.params.query?.['locationId']).toBeUndefined()
  })

  it('allowGlobalData=true ersetzt ein injiziertes Client-$or (Injection neutralisiert)', async () => {
    const { ctx } = buildContext({
      method: 'find',
      user: staffUser,
      query: { $or: [{ tenantId: 'FREMD' }] },
    })
    await run(ctx, { isolateLocation: true, allowGlobalData: true })
    expect(ctx.params.query?.['$or']).toEqual([{ locationId: 'loc-1' }, { locationId: null }])
  })

  it('tenant:owner und tenant:manager sind privilegiert — kein Location-Filter', async () => {
    for (const role of [UserSystemRole.TENANT_OWNER, UserSystemRole.TENANT_MANAGER]) {
      const { ctx } = buildContext({
        method: 'find',
        user: { _id: 'u4', role, tenantId: 't1', locationId: 'loc-1' },
        query: {},
      })
      await run(ctx, { isolateLocation: true })
      expect(ctx.params.query?.['locationId'], `role=${role}`).toBeUndefined()
      expect(ctx.params.query?.['$or'], `role=${role}`).toBeUndefined()
      expect(ctx.params.query?.['tenantId'], `role=${role}`).toBe('t1')
    }
  })

  it('Geraete-Rolle (device:pos-client) ist nicht privilegiert — Filial-Filter greift', async () => {
    const { ctx } = buildContext({
      method: 'find',
      user: { _id: 'dev1', role: UserSystemRole.DEVICE_POS, tenantId: 't1', locationId: 'loc-1' },
      query: {},
    })
    await run(ctx, { isolateLocation: true })
    expect(ctx.params.query?.['locationId']).toBe('loc-1')
  })

  it('nicht-privilegierter User OHNE locationId: kein Location-Filter (nur Tenant-Scope)', async () => {
    const { ctx } = buildContext({
      method: 'find',
      user: { _id: 'u5', role: UserSystemRole.TENANT_STAFF, tenantId: 't1' },
      query: {},
    })
    await run(ctx, { isolateLocation: true })
    expect(ctx.params.query?.['locationId']).toBeUndefined()
    expect(ctx.params.query?.['tenantId']).toBe('t1')
  })
})

describe('multiTenancy() — platform:*-Bypass', () => {
  const platformUser: MockUser = { _id: 'p1', role: 'platform:owner', tenantId: 't1', locationId: 'loc-1' }

  it('READ: kein tenantId-Filter fuer platform-Rollen', async () => {
    const { ctx } = buildContext({ method: 'find', user: platformUser, query: {} })
    const next = await run(ctx)
    expect(ctx.params.query?.['tenantId']).toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
  })

  it('WRITE: fehlende tenantId wird via stampEdgeDefaults aus dem User gestempelt', async () => {
    const { ctx } = buildContext({ method: 'create', user: platformUser, data: { name: 'Brot' } })
    await run(ctx)
    expect(ctx.data?.tenantId).toBe('t1')
  })

  it('WRITE: bereits gesetzte data.tenantId wird NICHT ueberschrieben (Platform darf fremd schreiben)', async () => {
    const { ctx } = buildContext({ method: 'create', user: platformUser, data: { tenantId: 't-fremd' } })
    await run(ctx)
    expect(ctx.data?.tenantId).toBe('t-fremd')
  })

  it('WRITE + isolateLocation=true: locationId wird auch ohne Key in data gestempelt', async () => {
    const { ctx } = buildContext({ method: 'create', user: platformUser, data: { name: 'Brot' } })
    await run(ctx, { isolateLocation: true })
    expect(ctx.data?.locationId).toBe('loc-1')
  })

  it('WRITE ohne isolateLocation: locationId nur gestempelt, wenn Key in data vorhanden und leer', async () => {
    const { ctx } = buildContext({ method: 'create', user: platformUser, data: { name: 'X', locationId: null } })
    await run(ctx)
    expect(ctx.data?.locationId).toBe('loc-1')
  })

  it('WRITE: data.tenantId vorhanden + kein locationId-Key + kein isolateLocation → early return ohne Lookup', async () => {
    const { ctx, locationsService } = buildContext({ method: 'create', user: platformUser, data: { tenantId: 't9' } })
    await run(ctx)
    expect(ctx.data).toEqual({ tenantId: 't9' })
    expect(locationsService.find).not.toHaveBeenCalled()
  })

  it('WRITE: platform-User OHNE tenantId → Fallback-Lookup der einzigen Edge-Location', async () => {
    const { ctx, locationsService } = buildContext({
      method: 'create',
      user: { _id: 'p2', role: 'platform:owner' },
      data: { name: 'Brot' },
      locationsResult: { data: [{ _id: 'loc-edge', tenantId: 't-edge' }] },
    })
    await run(ctx, { isolateLocation: true })
    expect(locationsService.find).toHaveBeenCalledOnce()
    expect(ctx.data?.tenantId).toBe('t-edge')
    expect(ctx.data?.locationId).toBe('loc-edge')
  })
})
