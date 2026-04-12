export interface RegularHour {
  day: number // 0=So, 1=Mo ... 6=Sa
  open: string // "HH:mm"
  close: string // "HH:mm"
  closed: boolean
}

export interface HourException {
  date: string // "YYYY-MM-DD"
  closed: boolean
  open?: string
  close?: string
}

export interface OpeningHoursResult {
  closed: boolean
  open?: string
  close?: string
}

/**
 * Ermittelt die Öffnungszeiten für ein bestimmtes Datum.
 * Ausnahmen haben Vorrang vor regulären Wochentagen.
 */
export function getOpeningHoursForDate(
  date: Date,
  regularHours: RegularHour[],
  exceptions: HourException[],
): OpeningHoursResult {
  const dateStr = formatDateISO(date)

  // 1. Ausnahme prüfen (exaktes Datum-Match)
  const exception = exceptions.find(e => e.date === dateStr)
  if (exception) {
    return {
      closed: exception.closed,
      open: exception.open,
      close: exception.close,
    }
  }

  // 2. Fallback auf regulären Wochentag
  const dayOfWeek = date.getDay() // 0=So, 1=Mo, ...
  const regular = regularHours.find(r => r.day === dayOfWeek)
  if (!regular) return { closed: true }

  return {
    closed: regular.closed,
    open: regular.open,
    close: regular.close,
  }
}

/**
 * Prüft ob ein Datum geschlossen ist (regulär oder Ausnahme).
 */
export function isDateClosed(
  date: Date,
  regularHours: RegularHour[],
  exceptions: HourException[],
): boolean {
  return getOpeningHoursForDate(date, regularHours, exceptions).closed
}

/**
 * Formatiert ein Date als "YYYY-MM-DD".
 */
export function formatDateISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
