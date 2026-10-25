export interface DayRow {
  date: Date
  status: 'worked' | 'off' | 'active'
  breakDuration: number
  netDuration: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Neueste Tage zuerst; mehrere Einträge eines Tages bleiben in ihrer Reihenfolge (später zuerst). */
export function newestFirst<T extends { date: Date }>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.date.getTime() - a.row.date.getTime() || b.index - a.index)
    .map(x => x.row)
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Monatssummen. Der laufende Tag zählt nicht zur Arbeitszeit und zu den Pausen (er ist noch nicht fertig), wohl aber zu den Arbeitstagen. */
export function monthTotals(rows: readonly DayRow[], now: Date) {
  const finished = rows.filter(r => r.status !== 'off' && !isSameDay(r.date, now))
  const workedDays = new Set(rows.filter(r => r.status !== 'off').map(r => r.date.getTime()))
  return {
    netMs: finished.reduce((sum, r) => sum + Math.max(0, r.netDuration), 0),
    breakMs: finished.reduce((sum, r) => sum + r.breakDuration, 0),
    workedDays: workedDays.size,
  }
}

/** „7:19" für die Tabelle. */
export function formatHoursMinutes(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`
}

/** „47 h 31 min" für die Summen. */
export function formatTotal(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`
}
