import { authenticate } from '@feathersjs/authentication'
import { BadRequest } from '@feathersjs/errors'
import { authorize, logger, multiTenancy } from '@panary/shared-backend'
import { CodeRedeemReason } from '@panary/discounts/domain'

import type { Application } from '../../declarations'
import { findConnectedCloudConnection } from '../../utils/cloud-connection-lookup'
import { decryptCloudToken } from '../../utils/cloud-token-cipher'
import { cloudFetch } from '../../workers/sync-apply'

export const discountCodeRedeemPath = 'discount-code-redeem'
export const discountCodeRedeemMethods = ['find', 'create'] as const

/**
 * Edge→Cloud-Proxy fuer Rabattcodes.
 *
 * Promo-Codes werden bewusst NICHT an den Edge gesynct: ein lokal mitgefuehrter
 * `usageCount` erzeugte bei mehreren Kassen und periodischem Sync Lost Updates
 * und Doppel-Einloesungen. Der POS spricht aber nur den Edge — also reicht der
 * Edge die Anfrage im Moment der Eingabe durch, statt Codes zu spiegeln.
 *
 * **Strikt online** (ADR 0032): Ohne erreichbare Cloud wird die Eingabe
 * abgelehnt, nicht geraten. Es gaebe auch nichts zu raten — der Edge kennt
 * weder den Code noch seinen Rabattwert. Die Bestellung laeuft dann ohne Code
 * weiter; ein manueller Rabatt bleibt jederzeit moeglich.
 */

/** Der POS soll nicht auf einen langsamen Cloud-Call warten — Kasse ist Takt. */
const CLOUD_TIMEOUT_MS = 5_000

export const CodeProxyReason = {
  /** Kein aktives Cloud-Pairing (Standalone-Betrieb). */
  NOT_PAIRED: 'not_paired',
  /** Pairing vorhanden, Cloud aber gerade nicht erreichbar (Netz, Timeout, 5xx). */
  CLOUD_UNREACHABLE: 'cloud_unreachable',
} as const
export type CodeProxyReason = (typeof CodeProxyReason)[keyof typeof CodeProxyReason]

export interface CodeCheckResult {
  ok: boolean
  reason: CodeRedeemReason | CodeProxyReason
  discount?: {
    discountId: string
    name: string
    valueType: string
    valuePercent: number
    valueCents: number
    isStaffMeal: boolean
  }
  redemptionId?: string
  discountCodeId?: string
  code?: string
}

interface CloudTarget {
  cloudUrl: string
  cloudToken: string
}

const resolveCloudTarget = async (app: Application): Promise<CloudTarget | null> => {
  const connection = await findConnectedCloudConnection(app)
  if (!connection?.cloudUrl) return null
  const cloudToken = decryptCloudToken(connection.cloudToken)
  if (!cloudToken) return null
  return { cloudUrl: connection.cloudUrl, cloudToken }
}

/**
 * Erreichbarkeit wird am Aufruf selbst gemessen, nicht am Sync-Zeitstempel:
 * „zuletzt erfolgreich gesynct" sagt etwas ueber Datenaktualitaet, nichts
 * darueber, ob die Cloud in dieser Sekunde antwortet.
 */
const callCloud = async (
  app: Application,
  path: string,
  init: RequestInit,
  operation: 'check' | 'redeem',
): Promise<CodeCheckResult> => {
  const target = await resolveCloudTarget(app)
  if (!target) {
    logger.warn({
      message: 'Rabattcode ohne aktives Cloud-Pairing angefragt',
      event: 'discount_code.not_paired',
      operation,
    })
    return { ok: false, reason: CodeProxyReason.NOT_PAIRED }
  }

  try {
    const response = await cloudFetch(target.cloudUrl, target.cloudToken, path, {
      ...init,
      timeoutMs: CLOUD_TIMEOUT_MS,
    })

    if (!response.ok) {
      // 4xx/5xx sind hier beide „nicht entschieden": Die fachliche Ablehnung
      // kommt als 200 mit ok:false. Ein Statuscode heisst also, dass die Cloud
      // die Frage nicht beantwortet hat (Token abgelaufen, Rate-Limit, Ausfall).
      logger.warn({
        message: 'Cloud lehnte Rabattcode-Anfrage ab',
        event: 'discount_code.cloud_error',
        operation,
        status: response.status,
      })
      return { ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE }
    }

    return (await response.json()) as CodeCheckResult
  } catch (err) {
    logger.warn({
      message: 'Cloud fuer Rabattcode nicht erreichbar',
      event: 'discount_code.cloud_unreachable',
      operation,
      errorName: err instanceof Error ? err.name : 'unknown',
    })
    return { ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE }
  }
}

const requireCode = (raw: unknown): string => {
  const code = String(raw ?? '').trim()
  if (!code) throw new BadRequest('Kein Rabattcode angegeben.')
  return code
}

const buildProxyService = (app: Application) => ({
  /** Pruefen ohne Verbrauch — Sofort-Rueckmeldung waehrend der Eingabe. */
  async find(params: { query?: Record<string, unknown> }): Promise<CodeCheckResult> {
    const code = requireCode(params?.query?.['code'])
    const search = new URLSearchParams({ code })
    const customerId = params?.query?.['customerId']
    if (customerId) search.set('customerId', String(customerId))
    return callCloud(app, `/discount-code-redeem?${search.toString()}`, { method: 'GET' }, 'check')
  },

  /** Einloesen — atomar in der Cloud gegen den append-only-Log. */
  async create(data: Record<string, unknown>): Promise<CodeCheckResult> {
    const code = requireCode(data?.['code'])
    return callCloud(
      app,
      '/discount-code-redeem',
      {
        method: 'POST',
        body: JSON.stringify({
          code,
          orderId: data?.['orderId'] ?? null,
          customerId: data?.['customerId'] ?? null,
          amountCents: data?.['amountCents'] ?? null,
        }),
      },
      'redeem',
    )
  },
})

export const discountCodeRedeem = (app: Application) => {
  // Kein DB-Backend und keine Nutzdaten in der Antwort — trotzdem `events: []`,
  // damit der Service keine Standard-Events emittiert.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Custom-Object-Service ohne Adapter
  app.use(discountCodeRedeemPath, buildProxyService(app) as any, {
    methods: discountCodeRedeemMethods,
    events: [],
    docs: {
      description: 'Rabattcode pruefen/einloesen — reicht an die Cloud durch (Codes liegen nicht am Edge)',
    },
  })

  app.service(discountCodeRedeemPath).hooks({
    around: {
      // multiTenancy stempelt hier nichts (kein Datensatz), begrenzt aber den
      // Aufruf auf authentifizierte Tenant-/Geraete-Kontexte — der Tenant selbst
      // kommt cloud-seitig aus dem Edge-Token, nie aus dem Request.
      all: [authenticate('jwt'), authorize(), multiTenancy({ isolateLocation: false, allowGlobalData: true })],
    },
  })
}
