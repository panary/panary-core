/**
 * Reservation-State-Machine (D-24).
 *
 * Erlaubte Transitions:
 *   pending   → confirmed | cancelled
 *   confirmed → cancelled | no-show
 *   cancelled (terminal)
 *   no-show   (terminal)
 *
 * `pending → no-show` ist bewusst NICHT erlaubt — eine Reservierung muss
 * zuerst confirmed werden, bevor sie als no-show markiert werden kann.
 * Status-Sprünge zurück (z. B. `cancelled → confirmed`) sind verboten;
 * Staff legt in solchen Fällen eine neue Reservierung an.
 *
 * Pure-Function — kein Service-Coupling, voll deterministisch und testbar.
 */
const VALID_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['cancelled', 'no-show'],
  cancelled: [],
  'no-show': [],
}

/**
 * Wirft `Error`, falls die Transition nicht erlaubt ist. Im Backend-Hook wird
 * das vom Feathers-Error-Handler in `400 BadRequest` umgewandelt (D-24).
 *
 * @param from aktueller Status
 * @param to angestrebter Status
 */
export function assertValidTransition(from: string, to: string): void {
  const allowed = VALID_TRANSITIONS[from] ?? []
  if (!allowed.includes(to)) {
    throw new Error(`Ungültige Status-Transition: ${from} → ${to}`)
  }
}

/** Boolean-Variante für UI-Checks (Buttons enable/disable). */
export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from] ?? []
  return allowed.includes(to)
}

/** Liefert die erlaubten Folge-States — z. B. für 3-Wege-Confirm-Dialoge im Admin. */
export function allowedTransitionsFrom(from: string): readonly string[] {
  return VALID_TRANSITIONS[from] ?? []
}
