// Bediener-Token am POS (panary/panary-core#619, ADR 0053).
//
// Am POS ist `params.user` der virtuelle Geraete-User `device:<uuid>`. Wer per
// PIN angemeldet ist, wusste bis #619 nur der Client (`localStorage.pos_current_user`),
// und den kann jeder am Geraet ueberschreiben. Das Token ist der Beleg, den nur
// ein erfolgreicher `verifyPin` erzeugt: vom Edge signiert, an genau dieses
// Geraet gebunden, kurzlebig.
import { NotAuthenticated } from '@feathersjs/errors'

import { logger } from '@panary/shared-backend'

import { isLoginBlockedByStatus } from './user-login-status'

import type { Application } from '../declarations'

/**
 * Eigene Audience, damit das Token und ein regulaeres Access-Token sich
 * gegenseitig nicht vertreten koennen: `authenticate('jwt')` und der Print-Server
 * pruefen gegen `jwtOptions.audience` und lehnen ein Bediener-Token ab; ein
 * Access-Token faellt hier an der Audience durch. Ohne diese Trennung bekaeme
 * ein Terminal mit dem PIN eines Managers dessen volle JWT-Session.
 */
export const POS_OPERATOR_TOKEN_AUDIENCE = 'urn:panary:pos-operator'

/** Zweites, unabhaengiges Merkmal im Payload — die Audience allein haengt an der Konfiguration. */
export const POS_OPERATOR_TOKEN_TYPE = 'pos-operator'

/**
 * Schichtlaenge mit Reserve. Der Inaktivitaets-Logout beendet die Sitzung am POS
 * meist frueher; die Laufzeit begrenzt nur, wie lange ein entwendetes Token traegt.
 */
export const POS_OPERATOR_TOKEN_EXPIRES_IN_SECONDS = 12 * 60 * 60

/**
 * Query-Schluessel, unter dem der POS das Token mitschickt. Ueber den Socket
 * kommen je Aufruf nur `data` und `query` an, keine Header; und die
 * Daten-Schemas sind teils geschlossen (`orderPatchSchema`, ADR 0052).
 * `resolvePosOperator` entfernt den Schluessel, bevor ein Query-Validator ihn sieht.
 */
export const POS_OPERATOR_TOKEN_QUERY_KEY = 'operatorToken'

/** Was ein gueltiges Token belegt. `role` ist frisch aus der DB, nicht aus dem Token. */
export interface PosOperator {
  userId: string
  role: string | null
  tenantId: string | null
}

/** Ausschnitt der Socket-Connection, den der Geraete-Handshake in channels.ts stempelt. */
interface DeviceConnection {
  apiKey?: boolean
  deviceId?: string
  tenantId?: string | null
}

interface PosOperatorTokenPayload {
  sub?: string
  typ?: string
  deviceId?: string
  tenantId?: string | null
}

const deviceConnectionOf = (connection: unknown): DeviceConnection | null => {
  const conn = connection as DeviceConnection | undefined
  if (!conn || conn.apiKey !== true || typeof conn.deviceId !== 'string' || !conn.deviceId) return null
  return conn
}

/**
 * Stellt das Token fuer einen per PIN bestaetigten User aus — nur fuer
 * Geraete-Verbindungen. Interne Aufrufe (`cash-sessions` prueft eine Freigabe
 * ueber `verifyPin`) und JWT-Sessions bekommen keines: Es gibt kein Geraet, an
 * das es sich binden liesse.
 */
export const issuePosOperatorToken = async (
  app: Application,
  user: { _id?: string; tenantId?: string | null },
  connection: unknown,
): Promise<{ operatorToken: string; operatorTokenExpiresAt: string } | null> => {
  const conn = deviceConnectionOf(connection)
  if (!conn || !user._id) return null

  const payload: PosOperatorTokenPayload = {
    typ: POS_OPERATOR_TOKEN_TYPE,
    deviceId: conn.deviceId,
    tenantId: conn.tenantId ?? null,
  }
  const operatorToken = await app.service('authentication').createAccessToken(payload, {
    subject: user._id,
    audience: POS_OPERATOR_TOKEN_AUDIENCE,
    expiresIn: POS_OPERATOR_TOKEN_EXPIRES_IN_SECONDS,
  })
  const operatorTokenExpiresAt = new Date(Date.now() + POS_OPERATOR_TOKEN_EXPIRES_IN_SECONDS * 1000).toISOString()
  return { operatorToken, operatorTokenExpiresAt }
}

/**
 * Einheitliche Meldung fuer jeden Ablehnungsgrund — der Grund steht im Log.
 * Ein eigener Text je Fall verriete am Terminal, ob ein Konto noch aktiv ist.
 */
export const POS_OPERATOR_REJECTED_MESSAGE = 'Bediener-Anmeldung ungueltig oder abgelaufen'

const reject = (reason: string, details: Record<string, unknown> = {}): never => {
  logger.warn({
    message: `Bediener-Token abgelehnt: ${reason}`,
    event: 'security.pos_operator_token_rejected',
    reason,
    ...details,
  })
  throw new NotAuthenticated(POS_OPERATOR_REJECTED_MESSAGE)
}

/**
 * Prueft ein mitgeschicktes Token gegen die aufrufende Geraete-Verbindung und
 * den aktuellen Konto-Stand. Wirft `NotAuthenticated` bei jedem Mangel.
 *
 * Das Konto wird bei jedem Aufruf frisch gelesen, aus demselben Grund wie in
 * `EdgeJWTStrategy` (#187): Ein archivierter Mitarbeiter verliert die Wirkung
 * seines Tokens sofort, nicht erst nach Ablauf.
 */
export const verifyPosOperatorToken = async (
  app: Application,
  token: unknown,
  connection: unknown,
): Promise<PosOperator> => {
  if (typeof token !== 'string' || !token) return reject('kein Token-String')

  const conn = deviceConnectionOf(connection)
  if (!conn) return reject('keine Geraete-Verbindung')

  let payload: PosOperatorTokenPayload
  try {
    payload = (await app
      .service('authentication')
      .verifyAccessToken(token, { audience: POS_OPERATOR_TOKEN_AUDIENCE })) as PosOperatorTokenPayload
  } catch (error) {
    return reject('Signatur, Audience oder Ablauf', {
      deviceId: conn.deviceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  if (payload.typ !== POS_OPERATOR_TOKEN_TYPE) return reject('falscher Token-Typ', { deviceId: conn.deviceId })
  if (payload.deviceId !== conn.deviceId) {
    return reject('Token gehoert zu einem anderen Geraet', { deviceId: conn.deviceId })
  }
  if ((payload.tenantId ?? null) !== (conn.tenantId ?? null)) {
    return reject('Mandant von Token und Geraet verschieden', { deviceId: conn.deviceId })
  }
  const userId = payload.sub
  if (typeof userId !== 'string' || !userId) return reject('kein Subject', { deviceId: conn.deviceId })

  let user: { _id: string; role?: string | null; status?: string | null; tenantId?: string | null }
  try {
    user = (await app.service('users').get(userId, { provider: undefined })) as typeof user
  } catch {
    return reject('Konto nicht gefunden', { deviceId: conn.deviceId, entityId: userId })
  }

  if (isLoginBlockedByStatus(user)) {
    return reject('Konto ist nicht aktiv', { deviceId: conn.deviceId, entityId: userId })
  }
  if (user.tenantId && conn.tenantId && user.tenantId !== conn.tenantId) {
    return reject('Konto gehoert nicht zum Mandanten des Geraets', { deviceId: conn.deviceId, entityId: userId })
  }

  return { userId: user._id, role: user.role ?? null, tenantId: user.tenantId ?? null }
}
