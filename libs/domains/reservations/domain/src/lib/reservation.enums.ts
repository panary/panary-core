/**
 * Reservation-Status (D-24 State-Machine):
 *   pending   → confirmed | cancelled
 *   confirmed → cancelled | no-show
 *   cancelled (terminal)
 *   no-show   (terminal)
 *
 * Als const-Object statt enum — kompatibel mit TypeBox `Type.Literal`-Union
 * im Schema (kein Enum-Importzwang auf der Konsumer-Seite).
 */
export const ReservationStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no-show',
} as const

export type ReservationStatusValue = (typeof ReservationStatus)[keyof typeof ReservationStatus]

/** Reihenfolge der gültigen Werte — wird auch vom Schema für Literal-Union benutzt. */
export const reservationStatusValues = ['pending', 'confirmed', 'cancelled', 'no-show'] as const
export type ReservationStatusLiteral = (typeof reservationStatusValues)[number]
