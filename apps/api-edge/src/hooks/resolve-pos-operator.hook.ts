// Bediener-Token auswerten (panary/panary-core#619, ADR 0053).
//
// Schritt 1 von 4: rein additiv. Ohne Token laeuft jeder Aufruf wie bisher;
// erst Schritt 3 macht `params.posOperator` zur Grundlage von Storno-Freigabe
// und Zurechnung, Schritt 4 verlangt es.
import type { HookContext, NextFunction } from '../declarations'
import { POS_OPERATOR_TOKEN_QUERY_KEY, type PosOperator, verifyPosOperatorToken } from '../utils/pos-operator-token'

declare module '@feathersjs/feathers' {
  interface Params {
    /** Per Bediener-Token belegter Mensch an der Kasse — nur gesetzt, wenn ein gueltiges Token mitkam. */
    posOperator?: PosOperator
  }
}

/**
 * Around-Hook (App-Level, hinter `allowApiKey` und `requireDeviceReverification`).
 *
 * - Kein Token in der Query: unveraendert weiter, `params.posOperator` bleibt leer.
 * - Token vorhanden: der Schluessel wird **immer** aus der Query entfernt — auch
 *   bei Ablehnung —, damit er weder einen Query-Validator noch einen Adapter
 *   erreicht. Gueltig → `params.posOperator`; ungueltig → `NotAuthenticated`.
 *
 * Abgelehnt statt still ignoriert: Ein Client, der ein Token schickt, verlaesst
 * sich auf die Zurechnung. Ein stilles Weiter liefe ab Schritt 3 auf eine
 * Handlung ohne belegten Bediener hinaus.
 */
export const resolvePosOperator = () => {
  return async (context: HookContext, next: NextFunction) => {
    const query = context.params.query as Record<string, unknown> | undefined
    if (!query || !Object.prototype.hasOwnProperty.call(query, POS_OPERATOR_TOKEN_QUERY_KEY)) {
      return next()
    }

    const { [POS_OPERATOR_TOKEN_QUERY_KEY]: token, ...rest } = query
    context.params.query = rest
    context.params.posOperator = await verifyPosOperatorToken(context.app, token, context.params.connection)

    return next()
  }
}
