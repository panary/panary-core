// Ein Formatter für alle Betragsausgaben — `new Intl.NumberFormat` pro Aufruf ist teuer.
const EUR_FORMAT = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

const ZERO = EUR_FORMAT.format(0)
const NEGATIVE_ZERO = EUR_FORMAT.format(-0)

/** Betrag in Euro als de-DE-Text („16,50 €"). `null`/`undefined`/`NaN` ergeben einen leeren Text. */
export function formatEur(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  const text = EUR_FORMAT.format(value)
  // −0 und Beträge unter einem halben Cent würden sonst als „-0,00 €" erscheinen.
  return text === NEGATIVE_ZERO ? ZERO : text
}

/** Betrag in Cent als de-DE-Text („1650" → „16,50 €"). */
export function formatEurCents(cents: number | null | undefined): string {
  return cents == null ? '' : formatEur(cents / 100)
}
