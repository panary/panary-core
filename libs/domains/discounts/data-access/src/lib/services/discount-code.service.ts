import { Injectable, inject } from '@angular/core'
import { ConnectionService } from '@panary/shared/data-access'
import type { CodeRedeemReason } from '@panary/discounts/domain'

/**
 * POS-Data-Access für Rabattcodes.
 *
 * Kein `BaseService`: Es gibt am Edge keine Code-Entität zum Cachen oder
 * Auflisten. Der Edge reicht beide Operationen im Moment der Eingabe an die
 * Cloud durch (ADR 0032) — Prüfen ist ein `find`, Einlösen ein `create`.
 */

/** Technische Gründe, die am Edge entstehen (die Cloud liefert `CodeRedeemReason`). */
export const CodeProxyReason = {
  NOT_PAIRED: 'not_paired',
  CLOUD_UNREACHABLE: 'cloud_unreachable',
} as const
export type CodeProxyReason = (typeof CodeProxyReason)[keyof typeof CodeProxyReason]

export type CodeResultReason = CodeRedeemReason | CodeProxyReason

export interface CodeDiscountView {
  discountId: string
  name: string
  valueType: string
  valuePercent: number
  valueCents: number
  isStaffMeal: boolean
}

export interface CodeCheckResult {
  ok: boolean
  reason: CodeResultReason
  discount?: CodeDiscountView
  redemptionId?: string
  discountCodeId?: string
  code?: string
}

/** Ablehnungen, die der Kassierer durch Warten oder Netz-Fix beheben kann. */
const TECHNICAL_REASONS: ReadonlySet<string> = new Set<string>([
  CodeProxyReason.NOT_PAIRED,
  CodeProxyReason.CLOUD_UNREACHABLE,
])

export const isTechnicalCodeFailure = (reason: CodeResultReason): boolean => TECHNICAL_REASONS.has(reason)

/** Kassentaugliche Klartexte. Kurz, ohne Fachjargon, ohne Schuldzuweisung. */
export const codeResultMessage = (reason: CodeResultReason): string => {
  switch (reason) {
    case 'ok':
      return 'Code gültig'
    case 'not_found':
      return 'Code unbekannt'
    case 'deleted':
      return 'Code wurde gelöscht'
    case 'expired':
      return 'Code ist abgelaufen'
    case 'limit_reached':
      return 'Code ist aufgebraucht'
    case 'wrong_customer':
      return 'Code gilt für einen anderen Kunden'
    case 'discount_inactive':
      return 'Rabatt ist nicht aktiv'
    case CodeProxyReason.NOT_PAIRED:
      return 'Keine Cloud-Verbindung eingerichtet — Rabattcodes sind hier nicht verfügbar'
    case CodeProxyReason.CLOUD_UNREACHABLE:
      return 'Cloud nicht erreichbar — Code kann gerade nicht geprüft werden'
    default:
      return 'Code kann nicht eingelöst werden'
  }
}

@Injectable({ providedIn: 'root' })
export class DiscountCodeService {
  readonly #service = inject(ConnectionService).discountCodeRedeemService

  /** Prüft einen Code, ohne ihn zu verbrauchen. Wirft nicht — Ablehnung ist ein Ergebnis. */
  async check(code: string, customerId?: string | null): Promise<CodeCheckResult> {
    const query: Record<string, string> = { code }
    if (customerId) query['customerId'] = customerId
    try {
      return (await this.#service.find({ query })) as CodeCheckResult
    } catch {
      // Der Edge antwortet auf technische Fehler bereits mit ok:false. Kommt
      // trotzdem eine Exception (Socket weg, 500 am Edge selbst), ist das aus
      // Kassensicht dasselbe: nicht entschieden, nicht abgelehnt.
      return { ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE }
    }
  }

  /**
   * Löst den Code ein. Erst dieser Aufruf verbraucht ihn — deshalb beim
   * Bestellabschluss aufrufen, nicht schon beim Eintippen.
   */
  async redeem(input: {
    code: string
    orderId?: string | null
    customerId?: string | null
    amountCents?: number | null
  }): Promise<CodeCheckResult> {
    try {
      return (await this.#service.create({
        code: input.code,
        orderId: input.orderId ?? null,
        customerId: input.customerId ?? null,
        amountCents: input.amountCents ?? null,
      })) as CodeCheckResult
    } catch {
      return { ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE }
    }
  }
}
