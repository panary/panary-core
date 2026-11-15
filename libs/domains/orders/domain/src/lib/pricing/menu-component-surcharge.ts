import { multiplyCents, toCents } from './money'

// Lesefunktionen für den an der Bestellzeile festgeschriebenen Aufschlag einer Menü-Komponente (core#1452,
// Anker core#1445). Der Aufschlag wird beim Buchen bestimmt und gespeichert (`surcharge`, Euro brutto je Stück
// der Komponente, siehe `order.schema.ts`); Bon, Kasse und Cloud-Detail lesen ihn hier und leiten ihn nirgends
// selbst ab. Ein General-Preis der Filiale ist keine Anzeigequelle mehr.

interface SurchargeLine {
  amount?: number | null
  bundlePricingMode?: string | null
}

interface SurchargeComponent {
  amount?: number | null
  surcharge?: number | null
}

/**
 * Aufschlag je Stück der Komponente in Cents. `0` bei `FIXED_PROPORTIONAL` (die Komponenten sind im Festpreis
 * enthalten) und wenn das Feld fehlt, null oder nicht endlich ist (Bestand, ältere Kassen: kein Betrag).
 */
export function menuComponentSurchargePerUnitCents(line: SurchargeLine, component: SurchargeComponent): number {
  if (line.bundlePricingMode === 'FIXED_PROPORTIONAL') return 0
  const surcharge = component.surcharge
  if (typeof surcharge !== 'number' || !Number.isFinite(surcharge) || surcharge <= 0) return 0
  return toCents(surcharge)
}

/**
 * Aufschlag der ganzen Zeile in Cents: je Stück × `component.amount` × `line.amount`, dieselbe Skalierung wie die
 * Preis-Engine (`lineGrossCents`, Entscheidung 2026-07-04: Komponentenmenge mal Zeilenmenge). Fehlt eine Menge,
 * zählt sie als 1.
 */
export function menuComponentSurchargeLineCents(line: SurchargeLine, component: SurchargeComponent): number {
  const perUnit = menuComponentSurchargePerUnitCents(line, component)
  if (perUnit === 0) return 0
  const units = (component.amount ?? 1) * (line.amount ?? 1)
  return multiplyCents(perUnit, units)
}
