/**
 * Order-Status-Guard (Security-Review „order-status-fsm").
 *
 * BEWUSST KONSERVATIV: Es gibt KEINE Vollmatrix erlaubter Übergänge — der POS
 * setzt den Status in vielen legitimen Reihenfolgen (ACTIVE/PRODUCTION/PRODUCED
 * → COMPLETED, auch Direkt-Sprünge). Eine strikte Whitelist würde reale
 * Kassen-Flows mit 400 blockieren (Kassenausfall-Risiko). Verboten werden
 * ausschließlich illegale Rücksprünge aus den fiskalisch abgeschlossenen
 * TERMINAL-Status:
 *
 *   COMPLETED → UNCLAIMED | ABORTED          erlaubt  (TTL-Nichtabholung bzw.
 *                                            nachträglicher Storno/Refund)
 *   COMPLETED → ACTIVE | PRODUCTION | PRODUCED  verboten (fiskalischer Bon-Reopen)
 *   ABORTED   → *                            verboten (Storno ist endgültig)
 *
 * Same-Status (from === to) ist IMMER erlaubt — der order-stock-update- und die
 * TSE-Hooks patchen die Order intern (z. B. COMPLETED→COMPLETED für Marker) und
 * idempotente Re-Patches dürfen nicht abgelehnt werden.
 *
 * Warum COMPLETED NICHT hart terminal ist: `UNCLAIMED` ist laut `order.schema`
 * ausdrücklich „war COMPLETED, nach TTL nicht abgeholt" und ein Buchungs-Trigger;
 * `COMPLETED → ABORTED` ist der Refund-/Storno-Pfad (löst SALES_OUT_REVERSAL +
 * TSE-Storno aus). Beide Flows sind code-gestützt und müssen offen bleiben.
 *
 * Pure-Function ohne Framework-Kopplung (analog `reservations/state-machine`) —
 * wirft `Error`; der jeweilige Backend-Hook (Edge + Cloud) wandelt in
 * `BadRequest` (400). Bewusst KEIN `@feathersjs/errors`-Import hier: die
 * orders-domain wird auch vom Angular-Frontend konsumiert und bleibt
 * framework-neutral.
 */
import { OrderStatus } from './order.schema'

/**
 * Erlaubte Ziel-Status je fiskalisch abgeschlossenem Quell-Status. Fehlt ein
 * Quell-Status in dieser Map, gilt er als NICHT-terminal → alle Übergänge frei.
 */
const TERMINAL_STATUS_ALLOWED_EXITS: Readonly<Record<string, readonly string[]>> = {
  [OrderStatus.COMPLETED]: [OrderStatus.UNCLAIMED, OrderStatus.ABORTED],
  [OrderStatus.ABORTED]: [],
}

/**
 * Wirft `Error`, wenn der Übergang aus einem Terminal-Status heraus unzulässig
 * ist. Alle Vorwärts-Übergänge sowie Same-Status-Patches sind erlaubt.
 *
 * @param from aktueller Order-Status
 * @param to angestrebter Order-Status
 */
export function assertValidOrderStatusTransition(from: string, to: string): void {
  // Same-Status ist keine echte Transition — interne Marker-Patches und
  // idempotente Re-Patches müssen durchlaufen.
  if (from === to) return
  const allowedExits = TERMINAL_STATUS_ALLOWED_EXITS[from]
  // Quelle nicht terminal → jeder Vorwärts-Übergang erlaubt.
  if (allowedExits === undefined) return
  if (allowedExits.includes(to)) return
  throw new Error(`Ungültiger Order-Status-Übergang: ${from} → ${to}`)
}

/** Boolean-Variante für UI-Checks (Button enable/disable) — wirft nicht. */
export function isValidOrderStatusTransition(from: string, to: string): boolean {
  if (from === to) return true
  const allowedExits = TERMINAL_STATUS_ALLOWED_EXITS[from]
  if (allowedExits === undefined) return true
  return allowedExits.includes(to)
}
