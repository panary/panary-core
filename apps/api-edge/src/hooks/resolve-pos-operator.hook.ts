// Bediener-Token auswerten (panary/panary-core#619, ADR 0053).
//
// Der Hook entscheidet nichts, er belegt nur: `params.posOperator` ist der per
// Token nachgewiesene Mensch an der Kasse. Was ohne Nachweis geschieht,
// entscheidet die jeweilige Stelle — eine Berechtigung (Storno) lehnt ab, eine
// Zurechnung (`performedBy`) faellt auf „unbelegt" zurueck.
import { NotAuthenticated } from '@feathersjs/errors'

import type { HookContext, NextFunction } from '../declarations'
import { POS_OPERATOR_TOKEN_QUERY_KEY, type PosOperator, verifyPosOperatorToken } from '../utils/pos-operator-token'

declare module '@feathersjs/feathers' {
  interface Params {
    /** Per Bediener-Token belegter Mensch an der Kasse — nur gesetzt, wenn ein gueltiges Token mitkam. */
    posOperator?: PosOperator
    /** `true`, wenn ein Token mitkam, aber abgelehnt wurde. Der Grund steht im Log. */
    posOperatorRejected?: true
  }
}

/**
 * Around-Hook (App-Level, hinter `allowApiKey` und `requireDeviceReverification`).
 *
 * - Kein Token in der Query: unveraendert weiter.
 * - Token vorhanden: der Schluessel wird **immer** aus der Query entfernt, damit
 *   er weder einen Query-Validator noch einen Adapter erreicht. Gueltig →
 *   `params.posOperator`; ungueltig → `params.posOperatorRejected`, und der
 *   Aufruf laeuft weiter.
 *
 * 🚨 Bewusst kein Abbruch bei ungueltigem Token. `classifyOutboxError` stuft
 * 401 als `terminal` ein und verwirft den Eintrag: Ein offline erfasster
 * Auftrag, der erst nach Ablauf des Tokens nachgesendet wird, waere verloren.
 * Ein verlorener Bon wiegt schwerer als ein nicht belegter Bediener.
 */
export const resolvePosOperator = () => {
  return async (context: HookContext, next: NextFunction) => {
    const query = context.params.query as Record<string, unknown> | undefined
    if (!query || !Object.prototype.hasOwnProperty.call(query, POS_OPERATOR_TOKEN_QUERY_KEY)) {
      return next()
    }

    const { [POS_OPERATOR_TOKEN_QUERY_KEY]: token, ...rest } = query
    context.params.query = rest
    try {
      context.params.posOperator = await verifyPosOperatorToken(context.app, token, context.params.connection)
    } catch (error) {
      // Nur die erwartete Ablehnung wird zur Kennzeichnung; ein DB- oder
      // Programmfehler bleibt ein Fehler.
      if (!(error instanceof NotAuthenticated)) throw error
      context.params.posOperatorRejected = true
    }

    return next()
  }
}
