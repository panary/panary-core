import { LineComponent } from '../order.schema'
import { fromCents, multiplyCents, sumCents, toCents } from './money'

// Abschluss-Logik für FIXED_PROPORTIONAL-Bundles: das Hauptgericht wird als
// Komponente (role 'main') mit Normalpreis-GEWICHT geführt (Marktwertmethode,
// siehe compute-order-tax.ts). Fehlt ein explizites mainPrice am Produkt, dient
// der Restbetrag (Festpreis − Σ übrige Komponenten) als Gewicht — dann ist
// Σ Gewichte == Festpreis und die Engine-Verteilung bleibt summen-exakt.

/**
 * Hauptgericht-Gewicht (Euro, 2 Nachkommastellen) eines FIXED_PROPORTIONAL-Bundles.
 * Explizites `mainPrice` hat Vorrang; sonst Restbetrag (Festpreis − Σ Komponenten
 * price×amount), cents-intern gerechnet (kein Float-Drift) und auf 0 geklemmt.
 * Klemm-Fall (Σ Komponenten > Festpreis): Gewicht 0 → die Engine filtert die
 * preislose main-Komponente aus und verteilt den Festpreis ausschließlich über
 * die übrigen Komponenten (Verhalten in fixed-bundle-main.spec.ts gelockt).
 */
export function fixedBundleMainWeight(
  fixedPrice: number | null | undefined,
  explicitMainPrice: number | null | undefined,
  components: ReadonlyArray<Pick<LineComponent, 'price' | 'amount'>>,
): number {
  if (explicitMainPrice != null && explicitMainPrice >= 0) return explicitMainPrice
  const componentCents = sumCents(components.map(c => multiplyCents(toCents(c.price), c.amount)))
  return fromCents(Math.max(0, toCents(fixedPrice) - componentCents))
}

/**
 * Liefert die Komponentenliste eines FIXED_PROPORTIONAL-Bundles MIT Hauptgericht
 * (role 'main') an erster Stelle. Idempotent: existiert bereits eine
 * 'main'-Komponente, kommt die Liste inhaltlich unverändert zurück (kein
 * Doppel-main bei wiederholtem Bundle-Abschluss). `mainTemplate.price` wird
 * durch das berechnete Gewicht ersetzt. Pure — die Eingabe wird nicht mutiert.
 */
export function withFixedBundleMainComponent(
  components: ReadonlyArray<LineComponent>,
  mainTemplate: Omit<LineComponent, 'role'>,
  fixedPrice: number | null | undefined,
  explicitMainPrice: number | null | undefined,
): LineComponent[] {
  if (components.some(c => c.role === 'main')) return [...components]
  return [
    { ...mainTemplate, price: fixedBundleMainWeight(fixedPrice, explicitMainPrice, components), role: 'main' },
    ...components,
  ]
}
