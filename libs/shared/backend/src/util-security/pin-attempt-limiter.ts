// Fehlversuchs-Begrenzung fuer POS-PIN-Operationen (`verifyPin`, `changePin`).
//
// Hintergrund: Eine 4-stellige PIN spannt nur 10.000 Kombinationen auf, und
// bcrypt laeuft mit Cost-Faktor 6 (bewusst niedrig, weil vierstellig). Der
// komplette Raum ist damit in etwa einer Minute durchprobiert. `verifyPin` ist
// ueber den Geraete-Socket erreichbar und braucht nur die `userId`, die der
// Login-Screen ohnehin auflistet.
//
// Verfuegbarkeit schlaegt Haerte: Eine PIN-Sperre am Kassenterminal blockiert
// im Zweifel den laufenden Betrieb. Deshalb ein selbstaufloesendes
// Sliding Window mit kurzer Sperre — kein dauerhafter Lockout, kein
// Manager-Override noetig, keine manuelle Entsperrung. Ein Angreifer wird auf
// wenige Versuche pro Minute gedrosselt (Jahre statt Minuten fuer den
// Vollraum), ein vertippter Mitarbeiter wartet schlimmstenfalls eine Minute.
//
// Der Store ist prozesslokal (wie der Pairing-Limiter in device-pairing.ts).
// Am Single-Prozess-Edge ist das exakt; in der Multi-Instanz-Cloud ist es
// Best-Effort pro Instanz — dort ist der Limiter eine zusaetzliche Huerde,
// nicht die einzige Verteidigungslinie.

/** Fehlversuche, ab denen gesperrt wird. */
export const PIN_MAX_FAILURES = 10
/** Beobachtungsfenster: aeltere Fehlversuche zaehlen nicht mehr mit. */
export const PIN_FAILURE_WINDOW_MS = 5 * 60 * 1000
/** Dauer der Sperre, nachdem das Limit erreicht wurde. */
export const PIN_LOCKOUT_MS = 60 * 1000

interface PinFailureRecord {
  count: number
  windowStart: number
  lockedUntil: number
}

const failureStore = new Map<string, PinFailureRecord>()

/** Verhindert unbegrenztes Wachstum bei vielen unterschiedlichen Keys. */
const purgeStale = (now: number): void => {
  for (const [key, rec] of failureStore) {
    if (now > rec.lockedUntil && now - rec.windowStart > PIN_FAILURE_WINDOW_MS) {
      failureStore.delete(key)
    }
  }
}

/**
 * Prueft, ob der Key aktuell gesperrt ist. Liefert die Restdauer in Sekunden
 * (aufgerundet), sonst `null`. Die Sperre laeuft ohne Zutun aus.
 */
export const getPinLockoutSeconds = (key: string): number | null => {
  const rec = failureStore.get(key)
  if (!rec) return null

  const now = Date.now()
  if (now < rec.lockedUntil) return Math.ceil((rec.lockedUntil - now) / 1000)

  // Sperre abgelaufen: Zaehler zuruecksetzen, damit der naechste Fehlversuch
  // nicht sofort erneut sperrt.
  if (rec.lockedUntil > 0 || now - rec.windowStart > PIN_FAILURE_WINDOW_MS) {
    failureStore.delete(key)
  }
  return null
}

/** Zaehlt einen Fehlversuch. Ab `PIN_MAX_FAILURES` im Fenster wird gesperrt. */
export const recordPinFailure = (key: string): void => {
  const now = Date.now()
  purgeStale(now)

  const rec = failureStore.get(key)
  if (!rec || now - rec.windowStart > PIN_FAILURE_WINDOW_MS) {
    failureStore.set(key, { count: 1, windowStart: now, lockedUntil: 0 })
    return
  }

  rec.count++
  if (rec.count >= PIN_MAX_FAILURES) {
    rec.lockedUntil = now + PIN_LOCKOUT_MS
  }
}

/** Loescht den Zaehler nach erfolgreicher PIN-Pruefung. */
export const clearPinFailures = (key: string): void => {
  failureStore.delete(key)
}

/** Nur fuer Tests — setzt den prozesslokalen Store zurueck. */
export const resetPinAttemptLimiter = (): void => {
  failureStore.clear()
}
