/**
 * Validate-Order-Status-Transition-Hook (Security-Review „order-status-fsm").
 *
 * Before-Patch-Hook fuer den `orders`-Service. Blockiert illegale Rueckspruenge
 * aus den fiskalisch abgeschlossenen TERMINAL-Status (COMPLETED/ABORTED) via der
 * Pure-Function `assertValidOrderStatusTransition` aus `@panary/orders/domain`.
 * BEWUSST KONSERVATIV — alle Vorwaerts-Uebergaenge bleiben erlaubt (Details:
 * `order-state-machine.ts`).
 *
 * Laeuft NUR fuer echte externe Status-AENDERUNGEN:
 *   - Interne Aufrufe (kein `provider`) werden durchgelassen — Sync-/Marker-
 *     Patches duerfen den Status frei setzen.
 *   - Patches ohne `status` im Body (reine Feld-Updates) sind Pass-Through.
 *   - Same-Status-Patches laesst bereits der Helper durch.
 *   - Multi-Patch ohne konkrete `id` (kein eindeutiger Vorstatus) wird nicht
 *     geprueft (checkMultiOperation blockt externe Null-ID-Patches ohnehin).
 *
 * Der Vorstatus wird intern geladen (`provider: undefined`), damit `multiTenancy`
 * nicht filtert (sonst 404 statt 400 bei fremdem Tenant).
 */
import type { HookContext } from '@feathersjs/feathers'
import { BadRequest } from '@feathersjs/errors'

import { assertValidOrderStatusTransition } from '@panary/orders/domain'

export const validateOrderStatusTransition = async (context: HookContext): Promise<HookContext> => {
  if (context.method !== 'patch') return context
  // Interne Aufrufe (Sync-/Marker-Patches) nie blockieren.
  if (!context.params.provider) return context

  const newStatus = (context.data as { status?: string } | undefined)?.status
  if (!newStatus) return context
  if (context.id === null || context.id === undefined) return context

  const previous = (await context.service.get(context.id, {
    provider: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as { status?: string }
  if (!previous?.status) return context

  try {
    assertValidOrderStatusTransition(previous.status, newStatus)
  } catch (err) {
    throw new BadRequest(err instanceof Error ? err.message : String(err))
  }
  return context
}
