import { describe, expect, it } from 'vitest'

import { SAFE_LOG_FIELDS } from './log-bundle'
import {
  buildSetupTokenBanner,
  buildSetupTokenLogEntry,
  generateSetupToken,
  TOKEN_ALPHABET,
  TOKEN_EXCLUDED_LETTERS,
  SETUP_FAILURE_WINDOW_MS,
  SETUP_MAX_FAILURES,
  SETUP_REJECTION_STATUS,
  SETUP_TOKEN_TTL_MS,
  SetupTokenGuard,
} from './setup-token'

/** Steuerbare Uhr — jede Instanz gehoert genau einem Test (testing.md §10). */
function createClock(start = 1_000_000) {
  let now = start
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

const TOKEN = 'ABCD-2345'

describe('generateSetupToken', () => {
  // Das Alphabet wird abgeleitet — diese Erwartung ist der Gegenbeleg, dass
  // die Ableitung wirklich Crockford-Base32 ergibt und nicht irgendetwas.
  it('leitet das Alphabet zu 32 Zeichen ohne I, L, O, U ab', () => {
    expect(TOKEN_ALPHABET).toHaveLength(32)
    expect(TOKEN_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ')
  })

  it('liefert die Anzeigeform XXXX-XXXX aus dem verwechslungsarmen Alphabet', () => {
    const erlaubt = new RegExp(`^[${TOKEN_ALPHABET}]{4}-[${TOKEN_ALPHABET}]{4}$`)

    for (let i = 0; i < 50; i++) {
      expect(generateSetupToken()).toMatch(erlaubt)
    }
  })

  // Das Token wird vom Bildschirm abgetippt; I/L/O/U sind die Stolperstellen.
  it.each(TOKEN_EXCLUDED_LETTERS)('enthaelt nie den Buchstaben %s', buchstabe => {
    const alle = Array.from({ length: 200 }, () => generateSetupToken()).join('')

    expect(alle).not.toContain(buchstabe)
  })

  it('wuerfelt bei jedem Aufruf neu', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateSetupToken()))

    expect(tokens.size).toBeGreaterThan(45)
  })
})

describe('SetupTokenGuard.verify', () => {
  it('akzeptiert das richtige Token', () => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)

    expect(guard.verify('10.0.0.1', TOKEN)).toEqual({ ok: true })
  })

  // Abgetippt wird selten formtreu — der Suchraum aendert sich dadurch nicht.
  it.each(['abcd-2345', 'ABCD2345', ' abcd 2345 ', 'AbCd-2345'])('normalisiert die Eingabe %s', eingabe => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)

    expect(guard.verify('10.0.0.1', eingabe)).toEqual({ ok: true })
  })

  it.each([undefined, null, '', '   ', 42])('lehnt fehlendes Token ab (%s)', wert => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)

    expect(guard.verify('10.0.0.1', wert)).toEqual({ ok: false, reason: 'missing_token' })
  })

  it('lehnt ein falsches Token ab', () => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)

    expect(guard.verify('10.0.0.1', 'ZZZZ-9999')).toEqual({ ok: false, reason: 'invalid_token' })
  })

  it('lehnt ein Token falscher Laenge ab, ohne zu werfen', () => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)

    expect(() => guard.verify('10.0.0.1', 'AB')).not.toThrow()
    expect(guard.verify('10.0.0.1', 'AB')).toEqual({ ok: false, reason: 'invalid_token' })
  })

  it('lehnt nach Ablauf der Frist ab', () => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)

    clock.advance(SETUP_TOKEN_TTL_MS + 1)

    expect(guard.verify('10.0.0.1', TOKEN)).toEqual({ ok: false, reason: 'expired' })
  })

  it('akzeptiert kurz vor Ablauf noch', () => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)

    clock.advance(SETUP_TOKEN_TTL_MS - 1)

    expect(guard.verify('10.0.0.1', TOKEN)).toEqual({ ok: true })
  })

  it('lehnt ein bereits verbrauchtes Token ab', () => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)
    guard.markUsed()

    expect(guard.verify('10.0.0.1', TOKEN)).toEqual({ ok: false, reason: 'already_used' })
  })
})

describe('SetupTokenGuard — Rate-Limit', () => {
  it(`sperrt nach ${SETUP_MAX_FAILURES} Fehlversuchen derselben IP`, () => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)

    for (let i = 0; i < SETUP_MAX_FAILURES; i++) {
      expect(guard.verify('10.0.0.1', 'ZZZZ-9999').reason).toBe('invalid_token')
    }

    expect(guard.verify('10.0.0.1', 'ZZZZ-9999')).toEqual({ ok: false, reason: 'rate_limited' })
  })

  // Sonst waere das Limit eine Zaehlung des Durchprobierens, kein Schutz davor.
  it('sperrt auch das richtige Token, solange das Limit greift', () => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)

    for (let i = 0; i < SETUP_MAX_FAILURES; i++) guard.verify('10.0.0.1', 'ZZZZ-9999')

    expect(guard.verify('10.0.0.1', TOKEN)).toEqual({ ok: false, reason: 'rate_limited' })
  })

  it('sperrt andere IPs nicht mit', () => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)

    for (let i = 0; i < SETUP_MAX_FAILURES; i++) guard.verify('10.0.0.1', 'ZZZZ-9999')

    expect(guard.verify('10.0.0.2', TOKEN)).toEqual({ ok: true })
  })

  it('gibt die IP nach Ablauf des Zeitfensters wieder frei', () => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)

    for (let i = 0; i < SETUP_MAX_FAILURES; i++) guard.verify('10.0.0.1', 'ZZZZ-9999')
    clock.advance(SETUP_FAILURE_WINDOW_MS + 1)

    expect(guard.verify('10.0.0.1', TOKEN)).toEqual({ ok: true })
  })

  // Ein Betreiber mit altem Zettel ist kein Angreifer.
  it('zaehlt ein abgelaufenes Token nicht als Fehlversuch', () => {
    const clock = createClock()
    const guard = new SetupTokenGuard(TOKEN, clock.now)
    clock.advance(SETUP_TOKEN_TTL_MS + 1)

    for (let i = 0; i < SETUP_MAX_FAILURES + 5; i++) {
      expect(guard.verify('10.0.0.1', TOKEN).reason).toBe('expired')
    }
  })
})

describe('SETUP_REJECTION_STATUS', () => {
  // Die Verifikation des Issues verlangt ausdruecklich "nicht 500, sondern
  // klare 401/403" bzw. 429 beim Limit.
  it('bildet jeden Ablehnungsgrund auf einen sprechenden Status ab', () => {
    expect(SETUP_REJECTION_STATUS).toEqual({
      rate_limited: 429,
      missing_token: 401,
      invalid_token: 401,
      expired: 401,
      already_used: 409,
    })
  })
})

describe('Token-Ausgabe: zwei Kanaele, nur einer traegt den Klartext', () => {
  const EXPIRES = '2026-09-17T13:15:00.000Z'

  it('nennt das Token im Banner fuer den Menschen im docker logs', () => {
    const banner = buildSetupTokenBanner(TOKEN, EXPIRES)

    expect(banner).toContain(TOKEN)
    expect(banner).toContain(EXPIRES)
    expect(banner).toContain('SETUP-MODUS')
  })

  it('nennt die Frist in Minuten statt in Millisekunden', () => {
    expect(buildSetupTokenBanner(TOKEN, EXPIRES)).toContain(`(${SETUP_TOKEN_TTL_MS / 60000} Minuten)`)
  })

  // 🚨 Der eigentliche Regressionstest. Der Banner geht ueber process.stdout;
  // der Logger schreibt zusaetzlich nach data/logs/, und genau diese Dateien
  // sammelt buildLogBundle() fuer den log-export ein — ein Archiv, das der
  // Mandant ziehen kann und das an den externen Support geht. Wer den Klartext
  // hier hineinreicht, hebelt die Grenze aus, die ADR 0041 zieht.
  it('haelt das Token aus dem strukturierten Log-Eintrag heraus', () => {
    const eintrag = buildSetupTokenLogEntry(EXPIRES)
    const serialisiert = JSON.stringify(eintrag)

    expect(serialisiert).not.toContain(TOKEN)
    // Auch nicht in Teilen — das Alphabet ist klein, die Haelfte genuegt zum Raten.
    expect(serialisiert).not.toContain(TOKEN.split('-')[0])
  })

  it('haelt fest, DASS ein Setup-Modus lief, und bis wann', () => {
    const eintrag = buildSetupTokenLogEntry(EXPIRES)

    expect(eintrag['event']).toBe('setup.token_issued')
    expect(eintrag['expiresAt']).toBe(EXPIRES)
  })

  // Der Log-Eintrag nuetzt nur, wenn seine Felder den Export ueberleben.
  // `event` faellt sonst still raus (panary/panary-core#293).
  it('nutzt ausschliesslich Felder, die der log-export durchlaesst', () => {
    const eintrag = buildSetupTokenLogEntry(EXPIRES)
    const erlaubt = new Set<string>(SAFE_LOG_FIELDS)
    const verworfen = Object.keys(eintrag).filter(k => !erlaubt.has(k))

    // `expiresAt` steht bewusst nicht auf der Allowlist — es ist Zusatzkontext
    // fuer die Konsole, kein Bestandteil des Exports. `message` und `event`
    // muessen aber durchkommen, sonst ist der Eintrag im Export unsichtbar.
    expect(erlaubt.has('message')).toBe(true)
    expect(erlaubt.has('event')).toBe(true)
    expect(verworfen).toEqual(['expiresAt'])
  })
})
