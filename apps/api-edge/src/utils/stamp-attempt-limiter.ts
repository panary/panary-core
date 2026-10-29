// Fehlversuchs-Begrenzung fuer das Stempeln per Personalnummer (panary/panary-core#1197).
//
// Die Personalnummer ist 6-stellig (900 000 Werte) und der einzige Beleg am Login-Bildschirm. Ohne Zaehler waere
// jeder Treffer-oder-nicht ein Orakel. Gezaehlt werden nur Fehlversuche (unbekannt/unzulaessig), nie Treffer.
//
// Eigene Instanzen statt `pin-attempt-limiter` aus @panary/shared-backend: Dessen Store ist eine geteilte Map mit
// festen Schwellen und ohne Eskalation. Hier zaehlen zwei getrennte Schluessel (Geraet und Edge gesamt) mit eigenen
// Schwellen, und die Geraete-Sperre verdoppelt sich bei wiederholtem Erreichen.
//
// Prozesslokal wie die PIN-Sperre: ein Edge-Neustart setzt die Zaehler zurueck. Das ist akzeptiert, die Sperre
// loest sich ohnehin von selbst auf.

export interface StampLimiterConfig {
  /** Fehlversuche im Fenster, ab denen gesperrt wird. */
  maxFailures: number
  /** Beobachtungsfenster: aeltere Fehlversuche zaehlen nicht mehr mit. */
  windowMs: number
  /** Dauer der ersten Sperre. */
  lockoutMs: number
  /** Obergrenze der Sperre bei Eskalation. Gleich `lockoutMs` = keine Eskalation. */
  maxLockoutMs: number
}

/** Je Geraet: 5 Fehlversuche in 5 min → 60 s, bei jedem weiteren Erreichen verdoppelt bis 15 min. */
export const DEVICE_STAMP_LIMIT: StampLimiterConfig = {
  maxFailures: 5,
  windowMs: 5 * 60 * 1000,
  lockoutMs: 60 * 1000,
  maxLockoutMs: 15 * 60 * 1000,
}

/** Je Edge: Grobsperre ohne Eskalation, damit Vertipper bei Schichtbeginn nie alle Geraete lahmlegen. */
export const EDGE_STAMP_LIMIT: StampLimiterConfig = {
  maxFailures: 50,
  windowMs: 5 * 60 * 1000,
  lockoutMs: 60 * 1000,
  maxLockoutMs: 60 * 1000,
}

interface FailureRecord {
  count: number
  windowStart: number
  lockedUntil: number
  /** Wie oft das Limit erreicht wurde — bestimmt die Sperrdauer. */
  level: number
}

export interface StampAttemptLimiter {
  /** Restdauer der Sperre in Sekunden (aufgerundet) oder `null`. */
  lockoutSeconds: (key: string) => number | null
  /** Zaehlt einen Fehlversuch; liefert den Zaehlerstand im Fenster (0 direkt nach dem Sperren). */
  recordFailure: (key: string) => number
  /** Loescht Zaehler und Eskalationsstufe. */
  clear: (key: string) => void
  /** Nur fuer Tests. */
  reset: () => void
}

export const createStampAttemptLimiter = (config: StampLimiterConfig): StampAttemptLimiter => {
  const store = new Map<string, FailureRecord>()

  // Eine Eskalationsstufe bleibt so lange erhalten wie die laengste Sperre; wer danach ruhig war, faengt neu an.
  const isStale = (rec: FailureRecord, now: number): boolean =>
    now > rec.lockedUntil + config.maxLockoutMs && now - rec.windowStart > config.windowMs

  const purgeStale = (now: number): void => {
    for (const [key, rec] of store) if (isStale(rec, now)) store.delete(key)
  }

  return {
    lockoutSeconds: key => {
      const rec = store.get(key)
      if (!rec) return null
      const now = Date.now()
      return now < rec.lockedUntil ? Math.ceil((rec.lockedUntil - now) / 1000) : null
    },

    recordFailure: key => {
      const now = Date.now()
      purgeStale(now)

      const rec = store.get(key)
      if (!rec) {
        store.set(key, { count: 1, windowStart: now, lockedUntil: 0, level: 0 })
        return 1
      }
      // Fenster abgelaufen oder letzte Sperre vorbei: Zaehler neu, Stufe bleibt fuer die Eskalation.
      if (now > rec.lockedUntil && now - rec.windowStart > config.windowMs) {
        rec.count = 0
        rec.windowStart = now
      }
      rec.count++
      if (rec.count >= config.maxFailures && now >= rec.lockedUntil) {
        rec.level++
        rec.lockedUntil = now + Math.min(config.lockoutMs * 2 ** (rec.level - 1), config.maxLockoutMs)
        rec.count = 0
        rec.windowStart = now
        return config.maxFailures
      }
      return rec.count
    },

    clear: key => {
      store.delete(key)
    },

    reset: () => store.clear(),
  }
}

export const deviceStampLimiter = createStampAttemptLimiter(DEVICE_STAMP_LIMIT)
export const edgeStampLimiter = createStampAttemptLimiter(EDGE_STAMP_LIMIT)

/** Schluessel der Edge-weiten Grobsperre. */
export const EDGE_STAMP_KEY = 'edge'

/** Nur fuer Tests. */
export const resetStampLimiters = (): void => {
  deviceStampLimiter.reset()
  edgeStampLimiter.reset()
}
