import { Injectable, inject } from '@angular/core'
import { ConnectionService } from '@panary/shared/data-access'
import type { CodeRedeemReason } from '@panary/discounts/domain'

import { CodeProxyReason, codeProxyReasonForError } from './code-proxy-reason'

/**
 * POS-Data-Access für Rabattcodes.
 *
 * Kein `BaseService`: Es gibt am Edge keine Code-Entität zum Cachen oder
 * Auflisten. Der Edge reicht beide Operationen im Moment der Eingabe an die
 * Cloud durch (ADR 0032) — Prüfen ist ein `find`, Einlösen ein `create`.
 */

// Technische Gründe, die am Edge oder in der Kasse entstehen (die Cloud liefert `CodeRedeemReason`).
export { CodeProxyReason, codeProxyReasonForError } from './code-proxy-reason'

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
  CodeProxyReason.NOT_AUTHORIZED,
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
    case CodeProxyReason.NOT_AUTHORIZED:
      return 'Kasse ist für Rabattcodes nicht zugelassen — bitte den Support kontaktieren'
    default:
      return 'Code kann nicht eingelöst werden'
  }
}

/**
 * Zeitgrenze für das Prüfen eines Codes. Der Socket-Client puffert Aufrufe bei getrennter Verbindung
 * ohne eigenes Timeout; ohne Grenze stand der Dialog auf „Code wird geprüft…" (core#808, Muster
 * `withTimeout` aus core#635).
 */
export const CODE_CHECK_TIMEOUT_MS = 10_000

/** Verbindungszustände, in denen ein Aufruf nur gepuffert würde statt anzukommen. */
const UNREACHABLE_STATES: ReadonlySet<string> = new Set(['disconnected', 'error'])

@Injectable({ providedIn: 'root' })
export class DiscountCodeService {
  readonly #connection = inject(ConnectionService)
  readonly #service = this.#connection.discountCodeRedeemService

  #isUnreachable(): boolean {
    return UNREACHABLE_STATES.has(this.#connection.connectionState().status)
  }

  /** Prüft einen Code, ohne ihn zu verbrauchen. Wirft nicht — Ablehnung ist ein Ergebnis. */
  async check(code: string, customerId?: string | null): Promise<CodeCheckResult> {
    const query: Record<string, string> = { code }
    if (customerId) query['customerId'] = customerId
    if (this.#isUnreachable()) return { ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE }
    try {
      return (await withTimeout(this.#service.find({ query }), CODE_CHECK_TIMEOUT_MS)) as CodeCheckResult
    } catch (error) {
      // Der Edge antwortet auf technische Fehler bereits mit ok:false. Kommt
      // trotzdem eine Exception (Socket weg, 500 am Edge selbst), ist das aus
      // Kassensicht dasselbe: nicht entschieden, nicht abgelehnt. Nur eine
      // Zugangs-Ablehnung (401/403) bekommt ihren eigenen Grund (cloud#1429).
      return { ok: false, reason: codeProxyReasonForError(error) }
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
    // Bewusst nur die Vorprüfung, keine Zeitgrenze: Ein gepufferter Aufruf könnte nach Ablauf doch
    // noch ankommen und den Code verbrauchen, obwohl die Kasse die Bestellung schon verworfen hat.
    if (this.#isUnreachable()) return { ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE }
    try {
      return (await this.#service.create({
        code: input.code,
        orderId: input.orderId ?? null,
        customerId: input.customerId ?? null,
        amountCents: input.amountCents ?? null,
      })) as CodeCheckResult
    } catch (error) {
      return { ok: false, reason: codeProxyReasonForError(error) }
    }
  }
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject({ code: 408, message: 'timeout' }), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
