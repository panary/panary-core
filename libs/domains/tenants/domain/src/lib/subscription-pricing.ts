// Mengenrabatt-/Quote-Logik (Pricing-Tier-Modell §6.5)
//
// Single Source für die Preisberechnung bei Per-Location-Abrechnung mit
// Mengenrabatt. Konsumiert von der Admin-UI (Preisanzeige) und perspektivisch
// vom Stripe-Setup (tiered/graduated Price-Konfiguration). Reine Funktionen,
// keine Seiteneffekte — Cent-Integer, deterministisch.
//
// WICHTIG: Stripe bleibt die Billing-Wahrheit. Diese Funktion liefert die
// kanonische Quote/Anzeige; bei produktiver Stripe-Tiered-Pricing-Anbindung
// müssen die Tier-Schwellen hier und in der Stripe-Price identisch sein.

/** Mengenrabatt-Stufen (gilt einheitlich für connect/operate/control). */
export interface VolumeDiscountTier {
  /** Ab dieser Filialzahl (inklusive) gilt der Rabatt. */
  minLocations: number
  /** Rabatt in Prozent auf den Listen-Stückpreis je Filiale. */
  discountPct: number
}

// Plan §3.2: 1–2 Listenpreis, ab 3 −15 %, ab 10 −25 %, ab 25 Enterprise-Verhandlung
// (indikativ −35 %, aber individuell verhandelt → requiresEnterpriseQuote).
export const VOLUME_DISCOUNT_TIERS: ReadonlyArray<VolumeDiscountTier> = [
  { minLocations: 1, discountPct: 0 },
  { minLocations: 3, discountPct: 15 },
  { minLocations: 10, discountPct: 25 },
  { minLocations: 25, discountPct: 35 },
] as const

/** Ab dieser Filialzahl läuft die Bepreisung über eine Enterprise-Verhandlung. */
export const ENTERPRISE_NEGOTIATION_THRESHOLD = 25

/**
 * Ermittelt den Mengenrabatt-Prozentsatz für eine Filialzahl.
 * `locationCount < 1` wird wie 1 behandelt.
 */
export const resolveVolumeDiscountPct = (locationCount: number): number => {
  const count = Math.max(1, Math.floor(locationCount))
  let pct = 0
  for (const tier of VOLUME_DISCOUNT_TIERS) {
    if (count >= tier.minLocations) pct = tier.discountPct
  }
  return pct
}

export interface SubscriptionQuoteInput {
  /** Listen-Stückpreis je Filiale in Cent (für den gewählten Abrechnungszyklus). */
  unitPriceCents: number
  /** Anzahl Filialen. */
  locationCount: number
}

export interface SubscriptionQuote {
  locationCount: number
  /** Listen-Stückpreis je Filiale (vor Rabatt), Cent. */
  listUnitPriceCents: number
  /** Effektiver Stückpreis je Filiale (nach Rabatt), Cent. */
  effectiveUnitPriceCents: number
  discountPct: number
  /** Gesamt vor Rabatt = listUnitPriceCents · locationCount. */
  listTotalCents: number
  /** Gesamt nach Rabatt = effectiveUnitPriceCents · locationCount. */
  totalCents: number
  /** Ersparnis = listTotalCents − totalCents. */
  savingsCents: number
  /** Ab ENTERPRISE_NEGOTIATION_THRESHOLD Filialen: Sales-Verhandlung statt Self-Service. */
  requiresEnterpriseQuote: boolean
}

/**
 * Berechnet die Preis-Quote für N Filialen eines Plans mit Mengenrabatt.
 * Rundung pro Filiale (Per-Location-Abrechnung), dann Multiplikation —
 * spiegelt die tatsächliche Stripe-Quantity-Abrechnung wider.
 */
export const computeSubscriptionQuote = (input: SubscriptionQuoteInput): SubscriptionQuote => {
  const locationCount = Math.max(1, Math.floor(input.locationCount))
  const listUnitPriceCents = Math.max(0, Math.round(input.unitPriceCents))
  const discountPct = resolveVolumeDiscountPct(locationCount)

  const effectiveUnitPriceCents = Math.round((listUnitPriceCents * (100 - discountPct)) / 100)
  const listTotalCents = listUnitPriceCents * locationCount
  const totalCents = effectiveUnitPriceCents * locationCount

  return {
    locationCount,
    listUnitPriceCents,
    effectiveUnitPriceCents,
    discountPct,
    listTotalCents,
    totalCents,
    savingsCents: listTotalCents - totalCents,
    requiresEnterpriseQuote: locationCount >= ENTERPRISE_NEGOTIATION_THRESHOLD,
  }
}
