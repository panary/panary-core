// Bediener-Token am POS (panary/panary-core#619, ADR 0053, Schritt 3).
//
// `users.verifyPin` liefert an Geraete-Verbindungen ein vom Edge signiertes
// Token: der Beleg, dass dieser Mensch an diesem Terminal seinen PIN
// eingegeben hat. Der POS haelt es hier und schickt es bei schreibenden
// Aufrufen als `query.operatorToken` mit. Der Edge belegt damit den Bediener;
// ohne gueltiges Token gilt eine Zurechnung als „unbelegt“.
import { signal, type Signal } from '@angular/core'
import type { Params } from '@feathersjs/feathers'

/**
 * Eigener Schluessel neben `pos_current_user`: Den lesen sieben Stellen per
 * `JSON.parse`, und das Token gehoert in keine davon. Geleert wird er an
 * denselben Stellen wie `pos_current_user` (Logout, Geraete-Reset).
 */
export const POS_OPERATOR_TOKEN_STORAGE_KEY = 'pos_operator_token'

/** Gegenstueck zu `POS_OPERATOR_TOKEN_QUERY_KEY` in `apps/api-edge/src/utils/pos-operator-token.ts`. */
export const POS_OPERATOR_TOKEN_QUERY_KEY = 'operatorToken'

interface StoredPosOperatorToken {
  operatorToken: string
  operatorTokenExpiresAt: string
}

/**
 * Zaehlt jeden Bedienerwechsel (Anmelden, Abmelden) — beide laufen ueber die zwei Funktionen
 * unten. `localStorage` ist kein Signal: Wer den angemeldeten Mitarbeiter in einem `computed()`
 * aus `pos_current_user` liest, liest dieses Signal mit, sonst haelt ein Root-Dienst nach dem
 * Wechsel den vorigen Bediener fest (panary/panary-core#902).
 */
const posOperatorSessionVersion = signal(0)
export const posOperatorSession: Signal<number> = posOperatorSessionVersion.asReadonly()

const readStorage = (): StoredPosOperatorToken | null => {
  try {
    const raw = localStorage.getItem(POS_OPERATOR_TOKEN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredPosOperatorToken>
    if (typeof parsed.operatorToken !== 'string' || typeof parsed.operatorTokenExpiresAt !== 'string') return null
    return { operatorToken: parsed.operatorToken, operatorTokenExpiresAt: parsed.operatorTokenExpiresAt }
  } catch {
    return null
  }
}

/**
 * Uebernimmt das Token aus dem Rueckgabewert von `verifyPin`.
 *
 * Fehlt es dort (aelterer Edge, interner Aufruf), wird ein vorhandenes
 * **entfernt**: Sonst trueg die neue Sitzung das Token des vorigen Bedieners,
 * und der Edge rechnete dessen Namen zu.
 */
export const storePosOperatorToken = (verifyPinResult: unknown): void => {
  const source = (verifyPinResult ?? {}) as Partial<Record<keyof StoredPosOperatorToken, unknown>>
  try {
    if (typeof source.operatorToken === 'string' && typeof source.operatorTokenExpiresAt === 'string') {
      localStorage.setItem(
        POS_OPERATOR_TOKEN_STORAGE_KEY,
        JSON.stringify({ operatorToken: source.operatorToken, operatorTokenExpiresAt: source.operatorTokenExpiresAt }),
      )
    } else {
      localStorage.removeItem(POS_OPERATOR_TOKEN_STORAGE_KEY)
    }
  } catch {
    // Ohne Speicher gibt es kein Token — der Edge wertet die Aufrufe dann als unbelegt.
  }
  posOperatorSessionVersion.update(version => version + 1)
}

export const clearPosOperatorToken = (): void => {
  try {
    localStorage.removeItem(POS_OPERATOR_TOKEN_STORAGE_KEY)
  } catch {
    // siehe storePosOperatorToken
  }
  posOperatorSessionVersion.update(version => version + 1)
}

/**
 * Das Token des angemeldeten Bedieners, solange es nicht abgelaufen ist.
 * Ein abgelaufenes wuerde der Edge nur als ungueltig kennzeichnen und dafuer
 * eine Warnzeile je Aufruf schreiben — es bringt nichts, es mitzuschicken.
 */
export const currentPosOperatorToken = (now: number = Date.now()): string | null => {
  const stored = readStorage()
  if (!stored) return null
  const expiresAt = Date.parse(stored.operatorTokenExpiresAt)
  if (Number.isNaN(expiresAt) || expiresAt <= now) return null
  return stored.operatorToken
}

/**
 * Haengt das Token an `params.query`.
 *
 * - Ein vom Aufrufer schon gesetztes Token gewinnt — der Storno nach
 *   Manager-PIN schickt das des Managers, nicht das des angemeldeten Bedieners.
 * - `operatorToken: null` heisst „ausdruecklich keines“: Der Schluessel wird
 *   entfernt, und es wird auch keines ergaenzt. Sonst truege ein Storno, dessen
 *   Manager-PIN kein Token lieferte, das Token des Kassierers.
 */
export const withPosOperatorToken = (params: Params = {}, token: string | null = currentPosOperatorToken()): Params => {
  const query = (params.query ?? {}) as Record<string, unknown>
  if (typeof query[POS_OPERATOR_TOKEN_QUERY_KEY] === 'string') return params
  if (query[POS_OPERATOR_TOKEN_QUERY_KEY] === null) {
    const { [POS_OPERATOR_TOKEN_QUERY_KEY]: _suppressed, ...rest } = query
    return { ...params, query: rest }
  }
  if (!token) return params
  return { ...params, query: { ...query, [POS_OPERATOR_TOKEN_QUERY_KEY]: token } }
}

/** Params fuer einen Aufruf mit genau diesem Token — oder ausdruecklich ohne. */
export const posOperatorParams = (token: string | null | undefined): Params => ({
  query: { [POS_OPERATOR_TOKEN_QUERY_KEY]: typeof token === 'string' && token ? token : null },
})

/** Liest das Token aus `params.query`, z. B. um es in einen Outbox-Eintrag zu uebernehmen. */
export const posOperatorTokenOf = (params: Params | undefined): string | null => {
  const value = (params?.query as Record<string, unknown> | undefined)?.[POS_OPERATOR_TOKEN_QUERY_KEY]
  return typeof value === 'string' && value ? value : null
}

/**
 * Kennung, mit der der Edge ein mitgeschicktes, aber abgelehntes Bediener-Token beantwortet
 * (`401`, `data.reason`; abgelaufen nach 12 h oder fremdes Gerät). Gegenstück in
 * `apps/api-edge/src/services/users/time-clock-scope.ts` (panary/panary-core#903).
 */
export const POS_OPERATOR_REQUIRED_REASON = 'POS_OPERATOR_REQUIRED'

/**
 * Ist das die Ablehnung des Bediener-Tokens — nicht der Ablauf der Geräte-Sitzung? Nur der
 * Bediener muss sich neu per PIN anmelden; das Gerät bleibt angemeldet (panary/panary-core#923).
 */
export const isPosOperatorRejection = (error: unknown): boolean => {
  const { code, data } = (error ?? {}) as { code?: unknown; data?: { reason?: unknown } | null }
  return code === 401 && data?.reason === POS_OPERATOR_REQUIRED_REASON
}
