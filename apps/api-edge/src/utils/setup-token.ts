import crypto from 'node:crypto'

/**
 * Besitznachweis fuer den Setup-Endpunkt (panary/panary-core#323).
 *
 * `POST /api/setup` war unauthentifiziert: Wer den Edge im LAN erreichte,
 * konnte ihn einrichten. Und der Setup-Modus ist nicht auf die Erstinstallation
 * beschraenkt — bis #327 war er der Auffangzweig jedes Boot-Fehlers, seither
 * immerhin nur noch der Zustand "keine Konfiguration vorhanden".
 *
 * Statt eines Logins, den es auf einem frischen Geraet noch gar nicht geben
 * kann, verlangt der Endpunkt jetzt ein Token, das der Edge beim Start des
 * Setup-Modus selbst wuerfelt und **nur** ueber Container-Log und eine Datei im
 * Datenverzeichnis ausgibt. Beides erreicht nur, wer Zugriff auf den Host hat —
 * und wer den hat, braucht den Setup-Endpunkt nicht, um Schaden anzurichten.
 *
 * Verworfene Alternativen stehen im ADR; kurz: Ein physischer Knopf existiert
 * auf der Zielhardware nicht verlaesslich, und eine Bindung an die erste
 * zugreifende IP haette der erste Netzwerk-Scanner belegt.
 */

/**
 * Buchstaben, die im Token nicht vorkommen (Crockford-Base32). Das Token wird
 * vom Bildschirm abgetippt — `I`/`1` und `O`/`0` sind dabei die haeufigste
 * Fehlerquelle, und `U` faellt weg, damit kein Zufallswort entsteht, das
 * jemand nicht vorlesen moechte.
 */
export const TOKEN_EXCLUDED_LETTERS = ['I', 'L', 'O', 'U'] as const

/**
 * Das Alphabet wird abgeleitet statt ausgeschrieben. Zwei Gruende: Die
 * Ausschlussregel oben steht dann im Code und nicht nur im Kommentar — und ein
 * ausgeschriebenes `0123456789ABCDEFGHJKMNPQRSTVWXYZ` hat maximale Entropie
 * und wird von gitleaks als Secret gemeldet, was es offensichtlich nicht ist.
 */
export const TOKEN_ALPHABET = [
  ...'0123456789',
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode('A'.charCodeAt(0) + i)),
]
  .filter(c => !(TOKEN_EXCLUDED_LETTERS as readonly string[]).includes(c))
  .join('')

/** 8 Zeichen aus 32 Symbolen ≈ 1,1 × 10^12 Moeglichkeiten. */
const TOKEN_LENGTH = 8

/** Gruppentrenner nur zur Anzeige — beim Pruefen wird er wegnormalisiert. */
const TOKEN_GROUP_SIZE = 4

/**
 * Gueltigkeitsdauer ab Start des Setup-Modus. Grosszuegiger als der
 * Pairing-Code (10 min), weil eine Erstinstallation Wege zum Geraet, Rueckfragen
 * und Kaffee einschliesst — aber kurz genug, dass ein vergessener, nie
 * eingerichteter Edge nicht monatelang mit gueltigem Token im Netz steht.
 */
export const SETUP_TOKEN_TTL_MS = 30 * 60 * 1000

/** Rate-Limit wie beim Pairing-Redeem (`device-pairing.ts`). */
export const SETUP_MAX_FAILURES = 10
export const SETUP_FAILURE_WINDOW_MS = 60 * 1000

export type SetupTokenRejection = 'rate_limited' | 'missing_token' | 'invalid_token' | 'expired' | 'already_used'

export interface SetupTokenVerdict {
  ok: boolean
  reason?: SetupTokenRejection
}

/**
 * Erzeugt ein Token in der Anzeigeform `XXXX-XXXX`.
 *
 * `crypto.randomInt` statt `Math.random`: Der Wert ist der einzige
 * Besitznachweis, den es fuer diesen Endpunkt gibt.
 */
export function generateSetupToken(): string {
  let raw = ''
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    raw += TOKEN_ALPHABET[crypto.randomInt(0, TOKEN_ALPHABET.length)]
  }
  const groups: string[] = []
  for (let i = 0; i < raw.length; i += TOKEN_GROUP_SIZE) {
    groups.push(raw.slice(i, i + TOKEN_GROUP_SIZE))
  }
  return groups.join('-')
}

/**
 * Bringt Eingabe und Sollwert auf dieselbe Form: Grossbuchstaben, ohne
 * Trenner. Wer das Token abtippt, soll nicht an einem Bindestrich oder der
 * Feststelltaste scheitern — das kostet keine Sicherheit, der Suchraum bleibt
 * derselbe.
 */
function normalize(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase()
}

/**
 * Bewacht den Setup-Endpunkt: ein Token, eine Frist, eine Verwendung, plus
 * Rate-Limit je IP.
 *
 * Bewusst In-Memory und ohne Persistenz — genau wie der Pairing-Code-Store.
 * Ein Neustart des Containers **soll** ein neues Token erzeugen: Das ist der
 * dokumentierte Weg, ein abgelaufenes zu erneuern.
 */
export class SetupTokenGuard {
  private readonly token: string
  private readonly expiresAt: number
  private used = false
  private readonly failures = new Map<string, { count: number; windowStart: number }>()

  constructor(
    token: string,
    private readonly now: () => number = Date.now,
    ttlMs: number = SETUP_TOKEN_TTL_MS,
  ) {
    this.token = normalize(token)
    this.expiresAt = this.now() + ttlMs
  }

  /** Nur zur Anzeige in Log und Datei — nie in einer HTTP-Antwort. */
  get expiresAtIso(): string {
    return new Date(this.expiresAt).toISOString()
  }

  isRateLimited(ip: string): boolean {
    const rec = this.failures.get(ip)
    if (!rec) return false
    if (this.now() - rec.windowStart > SETUP_FAILURE_WINDOW_MS) {
      this.failures.delete(ip)
      return false
    }
    return rec.count >= SETUP_MAX_FAILURES
  }

  private recordFailure(ip: string): void {
    const now = this.now()
    const rec = this.failures.get(ip)
    if (!rec || now - rec.windowStart > SETUP_FAILURE_WINDOW_MS) {
      this.failures.set(ip, { count: 1, windowStart: now })
    } else {
      rec.count++
    }
  }

  /**
   * Prueft den mitgesendeten Wert. Reihenfolge ist Absicht: Das Rate-Limit
   * greift **vor** dem Vergleich, sonst waere es kein Schutz gegen das
   * Durchprobieren, sondern nur eine Zaehlung davon.
   *
   * Ein abgelaufenes oder verbrauchtes Token zaehlt **nicht** als Fehlversuch —
   * das ist kein Rateversuch, sondern ein Betreiber mit einem alten Zettel.
   */
  verify(ip: string, presented: unknown): SetupTokenVerdict {
    if (this.isRateLimited(ip)) return { ok: false, reason: 'rate_limited' }

    if (typeof presented !== 'string' || presented.trim() === '') {
      this.recordFailure(ip)
      return { ok: false, reason: 'missing_token' }
    }

    if (this.used) return { ok: false, reason: 'already_used' }
    if (this.now() > this.expiresAt) return { ok: false, reason: 'expired' }

    const candidate = normalize(presented)
    // Laengenvergleich zuerst: `timingSafeEqual` wirft bei ungleicher Laenge.
    // Die Laenge ist keine Information, die es zu schuetzen gaebe — sie steht
    // in diesem Quelltext.
    const a = Buffer.from(candidate, 'utf8')
    const b = Buffer.from(this.token, 'utf8')
    const matches = a.length === b.length && crypto.timingSafeEqual(a, b)

    if (!matches) {
      this.recordFailure(ip)
      return { ok: false, reason: 'invalid_token' }
    }

    return { ok: true }
  }

  /**
   * Entwertet das Token. Wird erst nach dem erfolgreichen Schreiben der
   * Konfiguration gerufen: Ein Token, das an einem Schreibfehler verbraucht
   * wuerde, zwaenge zu einem Container-Neustart, obwohl nichts passiert ist.
   */
  markUsed(): void {
    this.used = true
  }
}

/** Antwort-Status je Ablehnungsgrund. Getrennt gehalten, damit die Route nur mappt. */
export const SETUP_REJECTION_STATUS: Record<SetupTokenRejection, number> = {
  rate_limited: 429,
  missing_token: 401,
  invalid_token: 401,
  expired: 401,
  already_used: 409,
}
