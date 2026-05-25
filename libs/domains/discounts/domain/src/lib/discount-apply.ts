import {
  Discount,
  DiscountAppliesTo,
  DiscountChannel,
  DiscountEligibility,
  DiscountMethod,
  DiscountMinRequirement,
  DiscountStatus,
  DiscountValueType,
} from './discount.schema'

// Reine, deterministische Rabatt-Logik — ohne I/O, von Edge, Cloud und Frontend
// nutzbar (eine Wahrheit für Anwendung, Eligibility und abgeleiteten Status).

// Abgeleiteter Anzeige-Status (read-time aus activeFrom/activeUntil), siehe Plan F7.
export const DiscountDisplayStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SCHEDULED: 'SCHEDULED',
  EXPIRED: 'EXPIRED',
  ARCHIVED: 'ARCHIVED',
} as const
export type DiscountDisplayStatus = (typeof DiscountDisplayStatus)[keyof typeof DiscountDisplayStatus]

/**
 * Kontext für Eligibility-/Anwendungs-Prüfung. Order-agnostisch: der Aufrufer
 * (z. B. der api-edge-Order-Hook) extrahiert die Werte aus der Order und reicht
 * sie durch — so bleibt discounts/domain frei von einer Abhängigkeit zu orders/domain.
 */
export interface DiscountContext {
  channel?: string
  now?: Date
  orderGrossCents?: number
  itemCount?: number
  customerId?: string | null
  /** Kategorien, die in der Order vorkommen (für appliesTo=categories). */
  categoryIds?: string[]
  /** Produkt-externalIds, die in der Order vorkommen (für appliesTo=products). */
  productExternalIds?: string[]
}

/**
 * Rabattbetrag in Cents für eine gegebene Brutto-Basis. Geklemmt auf [0, baseGrossCents].
 *   PERCENT → round(base * valuePercent / 100)
 *   AMOUNT  → min(valueCents, base)
 */
export function resolveDiscountAmountCents(discount: Discount, baseGrossCents: number): number {
  if (baseGrossCents <= 0) return 0
  let amount: number
  if (discount.valueType === DiscountValueType.PERCENT) {
    amount = Math.round((baseGrossCents * discount.valuePercent) / 100)
  } else {
    amount = discount.valueCents
  }
  if (amount < 0) return 0
  return Math.min(amount, baseGrossCents)
}

/** Leere channels-Liste = alle Kanäle. Sonst muss der Kanal enthalten sein. */
export function discountAppliesToChannel(discount: Discount, channel: string | undefined): boolean {
  if (!discount.channels || discount.channels.length === 0) return true
  if (!channel) return true
  return discount.channels.includes(channel as (typeof DiscountChannel)[keyof typeof DiscountChannel])
}

/** Liegt `now` im optionalen Aktiv-Zeitraum (activeFrom/activeUntil)? */
export function isWithinActiveWindow(discount: Discount, now: Date): boolean {
  if (discount.activeFrom && now < new Date(discount.activeFrom)) return false
  if (discount.activeUntil && now > new Date(discount.activeUntil)) return false
  return true
}

/** Abgeleiteter Anzeige-Status für UI/Filter — ohne den gespeicherten Status zu mutieren. */
export function deriveDiscountDisplayStatus(discount: Discount, now: Date = new Date()): DiscountDisplayStatus {
  if (discount.status === DiscountStatus.DRAFT) return DiscountDisplayStatus.DRAFT
  if (discount.status === DiscountStatus.ARCHIVED) return DiscountDisplayStatus.ARCHIVED
  if (discount.activeFrom && now < new Date(discount.activeFrom)) return DiscountDisplayStatus.SCHEDULED
  if (discount.activeUntil && now > new Date(discount.activeUntil)) return DiscountDisplayStatus.EXPIRED
  return DiscountDisplayStatus.ACTIVE
}

/**
 * Ist der Rabatt aktuell auswählbar/anwendbar?
 * Phase 1: ACTIVE + Kanal passt + im Aktiv-Zeitraum. (Recurring-Window/Bedingungen → Phase 2.)
 */
export function isDiscountApplicable(discount: Discount, ctx: DiscountContext = {}): boolean {
  if (discount.status !== DiscountStatus.ACTIVE) return false
  const now = ctx.now ?? new Date()
  if (!isWithinActiveWindow(discount, now)) return false
  if (!discountAppliesToChannel(discount, ctx.channel)) return false
  return true
}

/**
 * Fachliche Konsistenz einer Rabatt-Definition. Liefert eine Liste von Problemen
 * (leeres Array = gültig). Als before-Hook im Service nutzbar (statt Discriminated Union).
 */
export function validateDiscountConsistency(discount: Discount): string[] {
  const errors: string[] = []

  if (discount.valueType === DiscountValueType.PERCENT) {
    if (discount.valuePercent <= 0 || discount.valuePercent > 100) {
      errors.push('valuePercent muss zwischen 0 (exkl.) und 100 liegen')
    }
  } else if (discount.valueType === DiscountValueType.AMOUNT) {
    if (discount.valueCents <= 0) errors.push('valueCents muss > 0 sein')
  }

  if (discount.appliesTo === DiscountAppliesTo.CATEGORIES && discount.categoryIds.length === 0) {
    errors.push('appliesTo=categories erfordert mindestens eine categoryId')
  }
  if (discount.appliesTo === DiscountAppliesTo.PRODUCTS && discount.productExternalIds.length === 0) {
    errors.push('appliesTo=products erfordert mindestens eine productExternalId')
  }

  if (discount.eligibility === DiscountEligibility.SPECIFIC && discount.customerIds.length === 0) {
    errors.push('eligibility=specific erfordert mindestens eine customerId')
  }

  if (discount.minRequirementType === DiscountMinRequirement.AMOUNT) {
    if (discount.minAmountCents == null || discount.minAmountCents <= 0) {
      errors.push('minRequirementType=amount erfordert minAmountCents > 0')
    }
  }
  if (discount.minRequirementType === DiscountMinRequirement.QUANTITY) {
    if (discount.minQuantity == null || discount.minQuantity <= 0) {
      errors.push('minRequirementType=quantity erfordert minQuantity > 0')
    }
  }

  return errors
}

//#region Phase 2 — Automatische Rabatte: Bedingungs-Auswertung

const HHMM = /^(\d{2}):(\d{2})$/

function minutesOfDay(time: string | null | undefined): number | null {
  if (!time) return null
  const m = HHMM.exec(time)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

/**
 * Liegt `now` im wiederkehrenden Fenster (Wochentage + Tageszeit, z. B. Happy Hour
 * Mo–Fr 17–19 Uhr)? Leere recurringWeekdays UND keine Zeitgrenzen ⇒ immer true.
 * Über-Mitternacht-Fenster (start > end) werden unterstützt.
 */
export function isWithinRecurringWindow(discount: Discount, now: Date = new Date()): boolean {
  const days = discount.recurringWeekdays ?? []
  const start = minutesOfDay(discount.recurringStartTime)
  const end = minutesOfDay(discount.recurringEndTime)
  if (days.length === 0 && start == null && end == null) return true

  if (days.length > 0 && !days.includes(now.getDay())) return false

  if (start != null && end != null) {
    const cur = now.getHours() * 60 + now.getMinutes()
    return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end
  }
  return true
}

/** Erfüllt die Order die Mindestanforderung (Betrag/Menge)? */
export function meetsMinRequirement(discount: Discount, ctx: DiscountContext): boolean {
  switch (discount.minRequirementType) {
    case DiscountMinRequirement.AMOUNT:
      return (ctx.orderGrossCents ?? 0) >= (discount.minAmountCents ?? 0)
    case DiscountMinRequirement.QUANTITY:
      return (ctx.itemCount ?? 0) >= (discount.minQuantity ?? 0)
    default:
      return true
  }
}

/** Ist der Kunde berechtigt? ALL ⇒ immer; SPECIFIC ⇒ identifizierter Kunde in der Liste. */
export function isEligibleCustomer(discount: Discount, ctx: DiscountContext): boolean {
  if (discount.eligibility !== DiscountEligibility.SPECIFIC) return true
  return !!ctx.customerId && discount.customerIds.includes(ctx.customerId)
}

/** Passt der Geltungsbereich (alle / bestimmte Kategorien / bestimmte Produkte)? */
export function matchesScope(discount: Discount, ctx: DiscountContext): boolean {
  switch (discount.appliesTo) {
    case DiscountAppliesTo.CATEGORIES:
      return (ctx.categoryIds ?? []).some(id => discount.categoryIds.includes(id))
    case DiscountAppliesTo.PRODUCTS:
      return (ctx.productExternalIds ?? []).some(id => discount.productExternalIds.includes(id))
    default:
      return true
  }
}

/**
 * Greift ein AUTOMATIK-Rabatt für die gegebene Order? Komponiert alle Bedingungen:
 * ACTIVE + Kanal + Aktiv-Zeitraum + Recurring-Fenster + Mindestanforderung +
 * Berechtigung + Geltungsbereich.
 */
export function isAutomaticDiscountApplicable(discount: Discount, ctx: DiscountContext = {}): boolean {
  if (discount.method !== DiscountMethod.AUTOMATIC) return false
  if (!isDiscountApplicable(discount, ctx)) return false
  const now = ctx.now ?? new Date()
  if (!isWithinRecurringWindow(discount, now)) return false
  if (!meetsMinRequirement(discount, ctx)) return false
  if (!isEligibleCustomer(discount, ctx)) return false
  if (!matchesScope(discount, ctx)) return false
  return true
}

/** Filtert eine Rabatt-Liste auf die aktuell greifenden Automatik-Rabatte. */
export function evaluateAutomaticDiscounts(discounts: Discount[], ctx: DiscountContext = {}): Discount[] {
  return discounts.filter(d => isAutomaticDiscountApplicable(d, ctx))
}

//#endregion
