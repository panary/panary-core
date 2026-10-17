import type { HookContext } from '@feathersjs/feathers'
import { getOrderGrossCents, type Order } from '@panary/orders/domain'

// Gespeichertes Brutto je Bestellung (panary/panary-core#728).
//
// `grossCents` ist immer `getOrderGrossCents()` des Stands, der gleich in der
// Datenbank liegt. Keine eigene Summenrechnung: Single Source bleibt
// `order-gross.ts`, dieselbe Funktion, die Bestellliste und Tagesabschluss lesen.
//
// 🚨 Muss NACH `resolveData` und VOR den JSON-Hooks stehen:
//   - nach dem Resolver, weil erst dann feststeht, was gespeichert wird — ein
//     externer Patch mit `splitOff` oder `lineItems` wird dort still gestrippt,
//     und ein Betrag aus dem ungestrippten Body waere ein zweiter Betrag fuer
//     dieselbe Bestellung. Aus demselben Grund ueberschreibt der Hook einen
//     mitgeschickten Wert immer: Ein Client setzt das Feld nie.
//   - vor `getJsonFieldHooks`, weil die `lineItems`/`payment`/`taxSnapshot` zu
//     Strings serialisieren.
//
// Patch: Feathers ersetzt je Spalte, also wird der Body auf den gespeicherten
// Stand gemergt. Jeder Patch rechnet neu, nicht nur „preisrelevante": Auch der
// Zahlungsabschluss (`payment`) oder ein Split veraendern den Betrag, und eine
// Liste der relevanten Felder waere die naechste Stelle, die driftet.
export const stampOrderGrossCents = async (context: HookContext) => {
  if (context.method === 'create') {
    if (Array.isArray(context.data)) {
      context.data = context.data.map(entry => withGrossCents(entry as Order))
    } else {
      context.data = withGrossCents(context.data as Order)
    }
    return context
  }

  if (context.method === 'patch') {
    // Multi-Patch sperrt `checkMultiOperation` vorher; ohne Id gibt es keinen Stand.
    if (context.id === null || context.id === undefined) return context

    const stored = (await context.app
      .service('orders')
      .get(context.id, { provider: undefined })
      .catch((error: { code?: number }) => {
        // Fehlt die Bestellung, scheitert der Patch gleich selbst mit 404. Jeder
        // andere Fehler bricht ab: Ein Patch ohne neu gerechnetes Brutto
        // hinterliesse still einen veralteten Betrag.
        if (error?.code === 404) return null
        throw error
      })) as Order | null
    if (!stored) return context

    const data = context.data as Partial<Order>
    const target: Order = { ...stored }
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) (target as Record<string, unknown>)[key] = value
    }
    context.data = { ...data, grossCents: getOrderGrossCents(target) }
  }

  return context
}

const withGrossCents = (order: Order): Order => ({ ...order, grossCents: getOrderGrossCents(order) })
