// Edge→Cloud-Proxy fuer Rabattcodes (ADR 0032, panary/panary-core#178).
//
// Geprueft wird das Verhalten an der Grenze: Was passiert, wenn die Cloud fehlt,
// schweigt oder mit einem Statuscode antwortet — und ob eine fachliche Ablehnung
// (200 mit ok:false) davon unterscheidbar bleibt. Die Einloesbarkeits-Logik
// selbst liegt in der Cloud und hat dort ihre Tests.
//
// **Isolation** (code-style.md §10): Jeder Test baut seine eigene App mit einer
// EIGENEN cloudUrl und traegt sich unter dieser URL in `HARNESSES` ein. Der
// gehoistete `cloudFetch`-Mock findet seinen Zustand darueber. `HARNESSES` ist
// eine Modul-Konstante, die nie neu zugewiesen wird — ein Nachzuegler aus einem
// abgebrochenen Test schreibt unter SEINEM Schluessel und erreicht die
// Aufzeichnung des naechsten Tests nicht.
import { BadRequest } from '@feathersjs/errors'
import { describe, expect, it, vi } from 'vitest'

// Statischer Import trotz Mocks: `vi.mock` wird gehoistet und greift damit auch
// hier. Ein dynamischer `await import()` auf Modulebene faellt in api-edge durch
// den Typecheck (Modul-Target ohne Top-Level-await).
import { CodeProxyReason, discountCodeRedeem, discountCodeRedeemPath } from './discount-code-redeem'

vi.mock('@feathersjs/authentication', () => ({ authenticate: (s: string) => `auth:${s}` }))

vi.mock('@panary/shared-backend', () => ({
  authorize: () => 'authorize',
  multiTenancy: () => 'multiTenancy',
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}))

vi.mock('@panary/discounts/domain', () => ({
  CodeRedeemReason: { OK: 'ok', NOT_FOUND: 'not_found', EXPIRED: 'expired', LIMIT_REACHED: 'limit_reached' },
}))

vi.mock('../../utils/cloud-connection-lookup', () => ({
  findConnectedCloudConnection: async (app: { __connection?: unknown }) => app.__connection ?? null,
}))

vi.mock('../../utils/cloud-token-cipher', () => ({
  decryptCloudToken: (value: string | null | undefined) => (value ? `plain:${value}` : null),
}))

vi.mock('../../workers/sync-apply', () => ({
  cloudFetch: async (cloudUrl: string, cloudToken: string, path: string, init: Record<string, unknown>) => {
    const h = HARNESSES.get(cloudUrl)
    h?.fetchCalls.push({ cloudUrl, cloudToken, path, init })
    if (h?.fetchThrows) throw h.fetchThrows
    const status = h?.responseStatus ?? 200
    return {
      ok: status < 400,
      status,
      json: async () => h?.responseBody ?? { ok: true, reason: 'ok' },
    } as Response
  },
}))

interface FetchCall {
  cloudUrl: string
  cloudToken: string
  path: string
  init: Record<string, unknown>
}

interface Harness {
  fetchCalls: FetchCall[]
  fetchThrows?: unknown
  responseStatus?: number
  responseBody?: unknown
}

/** Schluessel ist die je Test eindeutige cloudUrl — siehe Kopfkommentar. */
const HARNESSES = new Map<string, Harness>()
let harnessSeq = 0

interface ProxyService {
  find(params: { query?: Record<string, unknown> }): Promise<Record<string, unknown>>
  create(data: Record<string, unknown>): Promise<Record<string, unknown>>
}

interface Setup {
  harness: Harness
  service: ProxyService
  uses: Array<{ path: string; options: Record<string, unknown> }>
  hookCalls: Array<Record<string, unknown>>
}

const setup = (options: { paired?: boolean } & Partial<Harness> = {}): Setup => {
  const cloudUrl = `https://cloud-${++harnessSeq}.test`
  const harness: Harness = {
    fetchCalls: [],
    fetchThrows: options.fetchThrows,
    responseStatus: options.responseStatus,
    responseBody: options.responseBody,
  }
  HARNESSES.set(cloudUrl, harness)

  const uses: Setup['uses'] = []
  const hookCalls: Setup['hookCalls'] = []
  let instance: ProxyService | null = null

  const app = {
    __connection: options.paired === false ? null : { cloudUrl, cloudToken: 'tok' },
    use: (path: string, svc: unknown, opts: Record<string, unknown>) => {
      instance = svc as ProxyService
      uses.push({ path, options: opts })
    },
    service: () => ({ hooks: (h: Record<string, unknown>) => hookCalls.push(h) }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test-Doppel statt voller Feathers-App
  discountCodeRedeem(app as any)

  return { harness, service: instance as unknown as ProxyService, uses, hookCalls }
}

describe('discount-code-redeem (Edge-Proxy) — ohne erreichbare Cloud', () => {
  it('ohne aktives Pairing: not_paired, kein Cloud-Call', async () => {
    const { harness, service } = setup({ paired: false })
    const result = await service.find({ query: { code: 'WILLKOMMEN10' } })

    expect(result).toEqual({ ok: false, reason: CodeProxyReason.NOT_PAIRED })
    expect(harness.fetchCalls).toHaveLength(0)
  })

  it('Netzfehler/Timeout: cloud_unreachable statt Absturz', async () => {
    const { service } = setup({ fetchThrows: Object.assign(new Error('fetch failed'), { name: 'TypeError' }) })
    const result = await service.find({ query: { code: 'WILLKOMMEN10' } })

    expect(result).toEqual({ ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE })
  })

  it('Statuscode der Cloud (401/429/5xx) zaehlt als unentschieden, nicht als Ablehnung', async () => {
    // Eine fachliche Ablehnung kommt als 200 mit ok:false. Ein 401 heisst
    // dagegen: die Cloud hat die Frage gar nicht beantwortet — der Kassierer
    // darf daraus nicht „Code ungueltig" lesen.
    for (const status of [401, 429, 500]) {
      const { service } = setup({ responseStatus: status })
      const result = await service.find({ query: { code: 'WILLKOMMEN10' } })
      expect(result, `status=${status}`).toEqual({ ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE })
    }
  })
})

describe('discount-code-redeem (Edge-Proxy) — Durchreichen', () => {
  it('find reicht Code und Kunde als Query durch und gibt die Cloud-Antwort unveraendert zurueck', async () => {
    const body = {
      ok: true,
      reason: 'ok',
      discount: {
        discountId: 'disc-1',
        name: 'Willkommen 10%',
        valueType: 'PERCENT',
        valuePercent: 10,
        valueCents: 0,
        isStaffMeal: false,
      },
    }
    const { harness, service } = setup({ responseBody: body })
    const result = await service.find({ query: { code: 'willkommen10', customerId: 'cust-1' } })

    expect(result).toEqual(body)
    expect(harness.fetchCalls).toHaveLength(1)
    expect(harness.fetchCalls[0].path).toBe('/discount-code-redeem?code=willkommen10&customerId=cust-1')
    // Der Token wird entschluesselt weitergereicht, nie der Chiffretext.
    expect(harness.fetchCalls[0].cloudToken).toBe('plain:tok')
    expect(harness.fetchCalls[0].init['method']).toBe('GET')
  })

  it('fachliche Ablehnung der Cloud kommt unveraendert an (ok:false + Grund)', async () => {
    const { service } = setup({ responseBody: { ok: false, reason: 'limit_reached' } })
    const result = await service.find({ query: { code: 'AUSGESCHOEPFT' } })
    expect(result).toEqual({ ok: false, reason: 'limit_reached' })
  })

  it('create schickt Code, Bestellung und Betrag als JSON-Body', async () => {
    const { harness, service } = setup({ responseBody: { ok: true, reason: 'ok', redemptionId: 'r-1' } })
    const result = await service.create({ code: 'WILLKOMMEN10', orderId: 'order-1', amountCents: 250 })

    expect(result).toMatchObject({ ok: true, redemptionId: 'r-1' })
    const call = harness.fetchCalls[0]
    expect(call.path).toBe('/discount-code-redeem')
    expect(call.init['method']).toBe('POST')
    expect(JSON.parse(call.init['body'] as string)).toEqual({
      code: 'WILLKOMMEN10',
      orderId: 'order-1',
      customerId: null,
      amountCents: 250,
    })
  })

  it('leerer Code → BadRequest, ohne Cloud-Call', async () => {
    const { harness, service } = setup()
    await expect(service.find({ query: { code: '  ' } })).rejects.toBeInstanceOf(BadRequest)
    await expect(service.create({ code: '' })).rejects.toBeInstanceOf(BadRequest)
    expect(harness.fetchCalls).toHaveLength(0)
  })
})

describe('discount-code-redeem (Edge-Proxy) — Registrierung', () => {
  it('registriert find/create ohne Events und mit voller Auth-Kette', () => {
    const { uses, hookCalls } = setup()

    expect(uses[0].path).toBe(discountCodeRedeemPath)
    expect(uses[0].options['methods']).toEqual(['find', 'create'])
    expect(uses[0].options['events']).toEqual([])
    // authenticate + authorize + multiTenancy — ohne authorize() waere der
    // Service fuer jede Rolle offen, unabhaengig von der Matrix.
    expect((hookCalls[0]['around'] as { all: unknown[] }).all).toEqual(['auth:jwt', 'authorize', 'multiTenancy'])
  })
})
