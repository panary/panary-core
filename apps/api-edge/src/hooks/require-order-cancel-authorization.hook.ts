// Storno von Geraeten nur mit belegter Freigabe (panary/panary-core#619, ADR 0053, Schritt 4).
//
// Bis hierhin entschied allein der POS, ob ein Storno ohne PIN durchgeht: Er
// verglich `pos_current_user._id` mit der Managerliste — und die ID liess sich
// in den DevTools ueberschreiben. Selbst der PIN-Weg war nur am POS geprueft,
// der Edge nahm jeden Storno-Patch eines Geraets an.
//
// Seit Schritt 4 verlangt der Edge den Nachweis: ein Bediener-Token
// (`params.posOperator`, gesetzt von `resolvePosOperator`), dessen Konto zum
// Zeitpunkt des Aufrufs Manager oder Inhaber ist. Die Rolle kommt frisch aus der
// DB, nicht aus dem Token.
import { Forbidden } from '@feathersjs/errors'
import type { HookContext } from '@feathersjs/feathers'

import { OrderStatus } from '@panary/orders/domain'
import { logger } from '@panary/shared-backend'
import { ORDER_CANCEL_AUTHORIZING_ROLES } from '@panary/users/domain'

/**
 * Ein eigener Code, damit der POS die Ablehnung erkennt und auf den PIN-Schritt
 * zurueckfuehren kann, statt eine generische Fehlermeldung zu zeigen.
 */
export const ORDER_CANCEL_NOT_AUTHORIZED = 'ORDER_CANCEL_NOT_AUTHORIZED'

const isDeviceSession = (user: unknown): boolean => {
  const id = (user as { _id?: unknown } | undefined)?._id
  return typeof id === 'string' && id.startsWith('device:')
}

/**
 * Before-Hook am `orders`-Service fuer `patch` (direkt hinter
 * `validateOrderStatusTransition`) und `create` (ganz vorne) — jeweils vor allen
 * Kassen- und TSE-Hooks, ein abgelehnter Storno darf keine fiskalische
 * Nebenwirkung hinterlassen. `create` deshalb, weil eine gleich als `ABORTED`
 * angelegte Bestellung sonst denselben Storno ohne Freigabe waere.
 *
 * Greift nur bei externen Aufrufen von **Geraeten** mit Zielstatus `ABORTED`. Interne Aufrufe
 * (Sync, Worker) und JWT-Sessions im Admin pruefen `authorize()` und die Rolle
 * des angemeldeten Menschen; dort gibt es kein Geraet, an das ein Token gebunden waere.
 *
 * ⚠️ Ein offline erfasster Storno, der erst nach Ablauf des Tokens (12 h)
 * nachgesendet wird, wird hier abgelehnt (403, im Outbox-Nachversand terminal).
 * Bewusst: Eine Berechtigung, die sich durch Warten erschleichen liesse, waere
 * keine. Der Eintrag erscheint in der Liste der abgelehnten Uebertragungen.
 */
export const requireOrderCancelAuthorization = async (context: HookContext): Promise<HookContext> => {
  if ((context.method !== 'patch' && context.method !== 'create') || !context.params.provider) return context
  if ((context.data as { status?: unknown } | undefined)?.status !== OrderStatus.ABORTED) return context
  if (!isDeviceSession(context.params.user)) return context

  const operator = context.params.posOperator
  if (operator?.role && ORDER_CANCEL_AUTHORIZING_ROLES.has(operator.role)) return context

  // Schon storniert: ein wiederholter Patch (Nachversand nach verlorener
  // Bestaetigung) bucht nichts Neues. Abgelehnt landete er als „terminal“ unter
  // den gescheiterten Uebertragungen, obwohl der Storno laengst gilt.
  if (context.method === 'patch' && context.id !== null && context.id !== undefined) {
    const previous = (await context.service.get(context.id, { provider: undefined } as never)) as { status?: string }
    if (previous?.status === OrderStatus.ABORTED) return context
  }

  logger.warn({
    message: 'Storno abgelehnt: keine belegte Freigabe eines Managers oder Inhabers',
    event: 'security.order_cancel_unauthorized',
    reason: !operator
      ? context.params.posOperatorRejected
        ? 'Bediener-Token ungueltig'
        : 'kein Bediener-Token'
      : 'Rolle ohne Storno-Freigabe',
    entityId: context.id,
    operatorId: operator?.userId,
  })
  throw new Forbidden('Storno braucht die Freigabe eines Managers oder Inhabers', {
    code: ORDER_CANCEL_NOT_AUTHORIZED,
  })
}
