import { WorkingTime } from '@panary-core/working-times/domain'

export interface LaborAggregate {
  staffCount: number
  totalWorkedSeconds: number
  totalBreakSeconds: number
  totalHours: number
  breakdown: {
    regularHours: number
    /** Pflicht für DACH-Lohnsteuer: Stunden zwischen 20:00 und 06:00 separat zählen. */
    nightShiftHours: number
    /** Sonntags-/Feiertagsstunden — Markierung kommt nicht aus working-times,
        sondern aus dem Holiday-Calendar; hier bleibt es bei 0, bis das integriert ist. */
    holidayHours: number
    breakHours: number
  }
}

const ZERO_LABOR: LaborAggregate = Object.freeze({
  staffCount: 0,
  totalWorkedSeconds: 0,
  totalBreakSeconds: 0,
  totalHours: 0,
  breakdown: { regularHours: 0, nightShiftHours: 0, holidayHours: 0, breakHours: 0 },
})

/**
 * Aggregiert Arbeitszeit-Einträge eines Geschäftstages.
 *
 * Ein Eintrag, der den Tag überspannt (checkin gestern, checkout heute) wird
 * vollständig dem Geschäftstag zugeschlagen, dessen `businessDay`-Feld auf
 * den jeweiligen Tag zeigt — das ist Aufgabe des Service-Filters, nicht des
 * Aggregators.
 *
 * `checkoutDate=null` → noch nicht beendet; zählt mit der Zeit bis "jetzt"
 * für Live-Anzeige im Dashboard. Für Tagesabschluss-Reports gibt der Caller
 * `now` mit; standardmäßig wird `new Date()` verwendet, das macht Tests
 * nicht-deterministisch — Caller muss bei Tagesabschluss explizit setzen.
 */
export function aggregateLabor(
  workingTimes: ReadonlyArray<WorkingTime>,
  now: Date = new Date(),
): LaborAggregate {
  if (workingTimes.length === 0) return { ...ZERO_LABOR, breakdown: { ...ZERO_LABOR.breakdown } }

  const distinctUsers = new Set<string>()
  let totalWorkedSeconds = 0
  let totalBreakSeconds = 0
  let nightShiftSeconds = 0

  for (const wt of workingTimes) {
    distinctUsers.add(wt.userId)

    const start = new Date(wt.checkinDate).getTime()
    const end = wt.checkoutDate ? new Date(wt.checkoutDate).getTime() : now.getTime()
    const shiftSeconds = Math.max(0, Math.floor((end - start) / 1000))

    // Pausen abziehen
    let breakSeconds = 0
    for (const br of wt.breaks ?? []) {
      const bStart = new Date(br.from).getTime()
      const bEnd = br.to ? new Date(br.to).getTime() : now.getTime()
      breakSeconds += Math.max(0, Math.floor((bEnd - bStart) / 1000))
    }
    totalBreakSeconds += breakSeconds
    const workedSeconds = Math.max(0, shiftSeconds - breakSeconds)
    totalWorkedSeconds += workedSeconds

    // Night-Shift-Anteil (zwischen 20:00 und 06:00) — vereinfacht über
    // Stunden-Iteration in 1-Stunden-Schritten. Genau genug für KPI-Anzeige.
    nightShiftSeconds += computeNightShiftSeconds(start, end)
  }

  const totalHours = secondsToHours(totalWorkedSeconds)
  return {
    staffCount: distinctUsers.size,
    totalWorkedSeconds,
    totalBreakSeconds,
    totalHours,
    breakdown: {
      regularHours: totalHours - secondsToHours(nightShiftSeconds),
      nightShiftHours: secondsToHours(nightShiftSeconds),
      holidayHours: 0,
      breakHours: secondsToHours(totalBreakSeconds),
    },
  }
}

function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

function computeNightShiftSeconds(startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0
  let nightSeconds = 0
  // Schritt-Iteration in 5-Minuten-Slots — Genauigkeit > 99% bei vernünftiger Performance
  const stepMs = 5 * 60 * 1000
  for (let t = startMs; t < endMs; t += stepMs) {
    const d = new Date(t)
    const hour = d.getHours()
    if (hour >= 20 || hour < 6) nightSeconds += stepMs / 1000
  }
  return nightSeconds
}
