// Aufloesung der Auto-Logoff-Frist aus den Filial-Einstellungen
// (`location.settings.genericUserSettings`). Gegenstueck zum Mitarbeiter-Flag
// `isAutoLogOffEnabled` in @panary/users/domain.

/**
 * Untergrenze der Frist. Kein Geschmack, sondern Betriebsschutz: Das
 * urspruengliche Schema-Default lag bei 30 Sekunden — damit meldet sich die
 * Kasse mitten im Kundengespraech ab. Der Wert war nie wirksam, weil das Feld
 * bis zur Einfuehrung des Auto-Logoffs keinen Leser hatte; Bestandsfilialen
 * tragen ihn trotzdem in der DB. Die Klammer faengt sie ab, auch wenn die
 * Cloud-Migration (007) einmal nicht gelaufen ist.
 */
export const AUTO_LOG_OFF_MIN_SECONDS = 60

/** Frist, wenn nichts Brauchbares konfiguriert ist. */
export const AUTO_LOG_OFF_FALLBACK_SECONDS = 120

/**
 * Filial-Einstellung → Millisekunden.
 *
 * `autoLogOffTimeUnit` ist im Schema ein freies `Type.String()`, Bestandsdaten
 * koennen also alles enthalten. Eine unbekannte Einheit wird als Sekunden
 * gelesen — das ist der Schema-Default und damit die einzige Annahme, die
 * Altdaten nicht falsch interpretiert. Das Schema deshalb bewusst NICHT auf ein
 * StringEnum verengen: Bestandszeilen mit abweichendem Wert wuerden sonst an
 * `validateData` scheitern und — weil `locations` ueber den Sync laeuft — den
 * Datensatz terminal ablehnen.
 */
export const resolveAutoLogOffTimeoutMs = (
  settings?: {
    autoLogOffTime?: unknown
    autoLogOffTimeUnit?: unknown
  } | null,
): number => {
  const raw = Number(settings?.autoLogOffTime)
  const unit = String(settings?.autoLogOffTimeUnit ?? 'sec').toLowerCase()
  const factor = unit === 'min' ? 60 : unit === 'h' ? 3600 : 1
  const seconds = Number.isFinite(raw) && raw > 0 ? raw * factor : AUTO_LOG_OFF_FALLBACK_SECONDS

  return Math.max(seconds, AUTO_LOG_OFF_MIN_SECONDS) * 1000
}
