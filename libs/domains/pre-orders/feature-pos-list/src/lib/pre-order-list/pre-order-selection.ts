import type { PreOrder } from '@panary/pre-orders/data-access'

/**
 * Löst die Auswahl per `?select=<id>` auf („Als Nächstes abholen" auf Start, core#1025). Die Liste lädt nur
 * Vorbestellungen ab jetzt; eine heute schon fällige, noch offene fehlt dort und wird einzeln geholt.
 * `null` heißt: nicht mehr offen oder nicht auffindbar — die Seite zeigt dann einen Hinweis statt einer leeren Auswahl.
 */
export async function findRequestedPreOrder(
  id: string,
  listed: readonly PreOrder[],
  load: (id: string) => Promise<PreOrder>,
): Promise<PreOrder | null> {
  const inList = listed.find(order => order._id === id)
  if (inList) return inList
  try {
    const order = await load(id)
    return order.status === 'pending' ? order : null
  } catch {
    return null
  }
}
