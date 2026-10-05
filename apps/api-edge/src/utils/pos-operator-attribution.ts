// Zurechnung aus dem Bediener-Token (panary/panary-core#619, ADR 0053, Schritt 4b).
//
// Am Geraet ist `params.user` der virtuelle User `device:<uuid>`. Wer eine
// Handlung ausgefuehrt hat, schickte der POS bisher im Body mit (`performedBy`,
// `createdBy`, Journal-`userId`) — aus `pos_current_user`, das sich am Geraet
// ueberschreiben laesst. Seit Schritt 4b gilt bei Geraeten: Das Token schlaegt
// den Body.
//
// 🚨 Nie ablehnen (ADR 0053, Nachtrag): Fehlt ein gueltiges Token, bleibt der
// Body-Wert und die Zurechnung gilt als „unbelegt“ — im Log, nicht als Fehler.
// Ein abgelehnter Outbox-Eintrag waere ein verlorener Bon.
import { logger } from '@panary/shared-backend'

import type { Params } from '@feathersjs/feathers'

const DEVICE_USER_ID_PREFIX = 'device:'

export const isDeviceSession = (user: unknown): boolean => {
  const id = (user as { _id?: unknown } | undefined)?._id
  return typeof id === 'string' && id.startsWith(DEVICE_USER_ID_PREFIX)
}

interface AttributionContext {
  /** Service-Pfad und Feld fuer das Log, z. B. `orders` / `creationContext.createdBy`. */
  service: string
  field: string
  entityId?: unknown
}

/**
 * Der Bediener, dem eine Handlung eines **Geraets** zugerechnet wird:
 * `params.posOperator.userId`, sonst der Body-Wert mit Log-Eintrag
 * `security.pos_operator_unverified`.
 *
 * Fuer Nicht-Geraete (JWT-Session, interner Aufruf) gibt die Funktion den
 * Body-Wert unveraendert zurueck — dort entscheidet der jeweilige Resolver wie
 * bisher. Aufrufer pruefen `isDeviceSession` deshalb nicht selbst.
 */
export const attributedOperatorId = <TValue>(
  params: Params | undefined,
  bodyValue: TValue,
  where: AttributionContext,
): string | TValue => {
  if (!isDeviceSession((params as { user?: unknown } | undefined)?.user)) return bodyValue

  const operatorId = params?.posOperator?.userId
  if (operatorId) return operatorId

  logger.warn({
    message: `Zurechnung unbelegt: ${where.service}.${where.field} ohne gueltiges Bediener-Token`,
    event: 'security.pos_operator_unverified',
    reason: params?.posOperatorRejected ? 'Bediener-Token ungueltig' : 'kein Bediener-Token',
    service: where.service,
    field: where.field,
    entityId: where.entityId,
    // Der Body-Wert ist eine Mitarbeiter-ID, kein Geheimnis — und genau das, was
    // eine spaetere Auswertung „wer wurde unbelegt eingetragen?“ braucht.
    claimedUserId: bodyValue,
  })
  return bodyValue
}
