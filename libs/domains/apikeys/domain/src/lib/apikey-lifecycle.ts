// Lebenszyklus eines Geraete-API-Keys — Single Source of Truth fuer die Frage
// „darf dieser Schluessel noch authentifizieren, und ist eine Rotation faellig?".
//
// Framework-agnostisch (kein Feathers, kein Knex, keine Uhr): dieselbe Funktion
// laeuft im Edge-WS-Handshake, in der Print-Server-Middleware und — ueber das
// veroeffentlichte Paket @panary/apikeys — im Cloud-Pendant
// (panary/panary-cloud#447). API-Keys sind pro Backend isoliert (ein Edge-Key
// existiert nur in der Edge-SQLite, ein Cloud-Key nur in Mongo, `apikeys` steht
// in keiner Sync-Allowlist) — geteilt wird die Semantik, nicht der Datensatz.
//
// Grundsatz (Nutzer-Entscheidung 2026-09-16): Ein Ablaufdatum darf den Betrieb
// der Kassenkraft NIE unterbrechen. `validUntil` ist deshalb kein Fallbeil,
// sondern ein Rotations-Ausloeser mit Karenz. Das Sperrmittel ist und bleibt
// `active: false` — siehe docs/adr/0042.

/** Lebensdauer eines frisch ausgestellten Geraete-Schluessels. */
export const APIKEY_TTL_DAYS = 180

/**
 * Restlaufzeit, ab der beim naechsten Handshake still rotiert wird.
 *
 * 60 Tage, weil die Rotation nur an einem Punkt stattfinden kann, an dem der
 * Client den neuen Schluessel auch entgegennimmt (WS-Handshake). Ein Geraet,
 * das nur alle paar Wochen neu startet, braucht mehrere Gelegenheiten, bevor
 * die Karenz ueberhaupt in Reichweite kommt.
 */
export const APIKEY_ROTATION_LEAD_DAYS = 60

/**
 * Karenz nach `validUntil`, in der ein abgelaufener Schluessel weiter
 * authentifiziert und die Rotation erzwungen wird.
 *
 * ⚠️ 90 Tage sind eine Setzung, keine Messung: Es gibt im Repo KEINE
 * dokumentierte Annahme darueber, wie lange ein POS-Geraet offline sein darf
 * (fuer Edge↔Cloud existieren Keepalive 4 h und Freshness 5 h, fuer POS↔Edge
 * nichts Vergleichbares). Betriebsferien ueber 90 Tage sind durch nichts
 * ausgeschlossen — der Wert ist bewusst grosszuegig gewaehlt und darf beim
 * Auftauchen echter Zahlen korrigiert werden.
 */
export const APIKEY_GRACE_DAYS = 90

/**
 * Alter, ab dem ein nie eingeloester `pendingApikey` als verloren gilt und neu
 * ausgestellt wird. Deckt den Fall ab, dass der neue Schluessel persistiert,
 * den Client aber nie erreicht hat (Socket stirbt zwischen Persist und Emit) —
 * ohne diese Frist bliebe die Rotation dauerhaft stecken, weil der Klartext des
 * pending-Schluessels serverseitig nirgends liegt und nicht erneut zustellbar ist.
 */
export const APIKEY_PENDING_STALE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export const APIKEY_TTL_MS = APIKEY_TTL_DAYS * DAY_MS
export const APIKEY_ROTATION_LEAD_MS = APIKEY_ROTATION_LEAD_DAYS * DAY_MS
export const APIKEY_GRACE_MS = APIKEY_GRACE_DAYS * DAY_MS
export const APIKEY_PENDING_STALE_MS = APIKEY_PENDING_STALE_DAYS * DAY_MS

/** Zustand eines Schluessels zum Pruefzeitpunkt. */
export const ApikeyLifecycleState = {
  /** Unbefristeter Bestands-Schluessel — `validUntil` wird einmalig gestempelt. */
  UNSTAMPED: 'unstamped',
  /** Gueltig, Restlaufzeit ueber dem Rotations-Lead. */
  VALID: 'valid',
  /** Gueltig, aber Restlaufzeit unter dem Lead — Rotation faellig. */
  ROTATE: 'rotate',
  /** Abgelaufen, aber innerhalb der Karenz — authentifiziert weiter, Rotation erzwungen. */
  GRACE: 'grace',
  /** Jenseits der Karenz — Ablehnung. */
  EXPIRED: 'expired',
} as const
export type ApikeyLifecycleStateValue = (typeof ApikeyLifecycleState)[keyof typeof ApikeyLifecycleState]

export interface ApikeyLifecycle {
  state: ApikeyLifecycleStateValue
  /** Darf dieser Schluessel authentifizieren? (`active` wird hier NICHT geprueft.) */
  accepted: boolean
  /** Soll beim naechsten zustellbaren Kontakt ein neuer Schluessel ausgestellt werden? */
  rotationDue: boolean
  /** Restlaufzeit in Millisekunden; negativ in der Karenz, `null` ohne `validUntil`. */
  remainingMs: number | null
}

/**
 * Bewertet `validUntil` gegen `now`.
 *
 * Bewusst ohne `active`: Die Sperre ist eine andere Entscheidung mit einer
 * anderen Begruendung (ausdruecklicher Widerruf statt Alterung) und bleibt bei
 * den Aufrufern — sonst liest sich ein `accepted: true` hier wie eine
 * Gesamtfreigabe, die es nicht ist.
 */
export const evaluateApikeyLifecycle = (validUntil: string | null | undefined, now: number): ApikeyLifecycle => {
  if (!validUntil) {
    return { state: ApikeyLifecycleState.UNSTAMPED, accepted: true, rotationDue: false, remainingMs: null }
  }

  const expiresAt = new Date(validUntil).getTime()
  // Unlesbares Datum wie „nie gesetzt" behandeln: Ein kaputter Wert darf ein
  // Geraet nicht aussperren — der naechste Stempel repariert ihn.
  if (Number.isNaN(expiresAt)) {
    return { state: ApikeyLifecycleState.UNSTAMPED, accepted: true, rotationDue: false, remainingMs: null }
  }

  const remainingMs = expiresAt - now

  // `>=`: Rotiert wird, wenn die Restlaufzeit den Lead UNTERSCHREITET — auf der
  // Grenze selbst noch nicht.
  if (remainingMs >= APIKEY_ROTATION_LEAD_MS) {
    return { state: ApikeyLifecycleState.VALID, accepted: true, rotationDue: false, remainingMs }
  }
  if (remainingMs > 0) {
    return { state: ApikeyLifecycleState.ROTATE, accepted: true, rotationDue: true, remainingMs }
  }
  if (remainingMs > -APIKEY_GRACE_MS) {
    return { state: ApikeyLifecycleState.GRACE, accepted: true, rotationDue: true, remainingMs }
  }
  return { state: ApikeyLifecycleState.EXPIRED, accepted: false, rotationDue: false, remainingMs }
}

/** Ablaufdatum eines frisch ausgestellten oder rotierten Schluessels. */
export const nextApikeyValidUntil = (now: number): string => new Date(now + APIKEY_TTL_MS).toISOString()

/**
 * Ist ein bereits ausgestellter, aber nie eingeloester `pendingApikey` so alt,
 * dass er als verloren gilt? Ohne Zeitstempel: ja (Bestand aus einer Version
 * ohne das Feld — neu ausstellen ist der sichere Weg, der alte Schluessel
 * bleibt dabei unangetastet gueltig).
 */
export const isPendingApikeyStale = (pendingCreatedAt: string | null | undefined, now: number): boolean => {
  if (!pendingCreatedAt) return true
  const createdAt = new Date(pendingCreatedAt).getTime()
  if (Number.isNaN(createdAt)) return true
  return now - createdAt > APIKEY_PENDING_STALE_MS
}
