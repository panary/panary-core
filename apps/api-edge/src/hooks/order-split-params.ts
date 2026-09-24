/**
 * Wer darf `splitOff` / `splitRoundingRemainderCents` an einer Bestellung
 * schreiben? (panary/panary-core#349)
 *
 * 🚨 Die Felder senken ueber `effectiveLineItems()` das ausgewiesene Brutto UND
 * die Steuer. Ein Aufrufer, der sie selbst setzen koennte, rabattierte seine
 * eigene Bestellung an der Rabattlogik vorbei — und zwar auf einem
 * steuerrelevanten Dokument. Sie gehoeren deshalb auf dieselbe Liste wie
 * `lineItems`.
 *
 * 🚫 Diese Datei existiert, damit es GENAU EINE Fassung der Bedingung gibt.
 * Ein erster Anlauf hatte sie nur im `orderPatchResolver` — der CREATE-Pfad und
 * der Steuer-Hook blieben offen, und beide Luecken sahen von aussen aus wie
 * Schutz. Wer die Regel aendert, aendert sie hier.
 */

/** Feathers-Params, soweit fuer die Entscheidung noetig. */
interface OrderSplitParams {
  provider?: string
  /** Gesetzt von `orders.split` — siehe `order-split.method.ts`. */
  orderSplit?: boolean
  /** Gesetzt vom Sync-Apply-Worker beim Einspielen eines Cloud-Records. */
  fromSync?: boolean
}

/**
 * Darf dieser Aufruf die Split-Felder schreiben?
 *
 * Zwei Wege, beide nur intern:
 *
 * 1. **`orders.split`** — der fachliche Schreibpfad.
 * 2. **Sync-Apply** — spielt einen Cloud-Record unveraendert ein. Ohne diesen
 *    Zweig verlöre ein Restore die Gegenbuchungen **still**: Die Bestellung
 *    käme ohne `splitOff` zurueck und wiese damit wieder die volle Steuer aus,
 *    ohne dass irgendwo ein Fehler erschiene.
 *
 * `params.provider === undefined` ist in beiden Faellen Pflicht. `params` baut
 * der Server — Feathers uebergibt einem externen Aufrufer Query und Route, nie
 * `params` selbst; ein Client erreicht die Marker also nicht. Der
 * `provider`-Check steht trotzdem da, damit die Freigabe nicht an einem
 * einzelnen Flag haengt.
 */
export function mayWriteOrderSplitFields(params: unknown): boolean {
  const p = params as OrderSplitParams | undefined
  if (!p || p.provider !== undefined) return false
  return p.orderSplit === true || p.fromSync === true
}
