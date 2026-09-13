/**
 * Reject-Legacy-Discount-Hook.
 *
 * Erzwingt serverseitig die Abschaffung des Legacy-Rabattfelds `order.discount`
 * (`assertNoLegacyDiscountWrite` aus `@panary/orders/domain`, ADR 0030): Rabatte
 * gehoeren als Snapshot nach `appliedDiscounts` — ein Client, der stattdessen
 * `discount` setzt, bekommt einen `400` statt eines still verworfenen Rabatts.
 *
 * Das Leeren (`discount: null`) bleibt erlaubt: Es ist der Migrationspfad fuer
 * Bestands-Orders, kein Legacy-Schreibzugriff.
 *
 * Laeuft NUR fuer echte externe Schreibzugriffe: interne Aufrufe (kein
 * `provider`) passieren den Guard. Die urspruengliche Begruendung dafuer —
 * der Sync-Apply patcht komplette Cloud-Records, ein 400 waere dort TERMINAL,
 * und stattdessen greife „weiterhin der Mutex `clearLegacyDiscountIfApplied`
 * im Data-Resolver" — ist hinfaellig: Diesen Mutex gibt es nicht mehr
 * (`@panary/orders/domain`, `pricing/discount-mutex.ts`), er ist mit ADR 0030
 * entfallen.
 *
 * 🚨 Die Ausnahme schuetzt deshalb nichts mehr, sie verschiebt den 400 nur.
 * Gemessen am 2026-09-13 (#308): `orderPatchSchema` ist ein `Type.Partial` von
 * `orderSchema` und erbt dessen `additionalProperties: false`; `validateData`
 * ist der unveraenderte Feathers-Hook ohne `provider`-Pruefung, und `orders`
 * hat — anders als `business-days` — KEINE `fromSync`-Weiche. Ein interner
 * Patch mit `discount` passiert also den Guard und scheitert zwei Hooks
 * spaeter an `validateData`, mit „must NOT have additional properties": genau
 * der unklaren Meldung, zu deren Vermeidung dieser Guard laut
 * `discount-mutex.ts` existiert.
 *
 * Entschieden mit #310: Der Sync-Apply-Pfad strippt `discount` jetzt selbst
 * (`workers/sync-apply.ts`, nur fuer `orders`) und protokolliert das als
 * `sync.pull.legacy_discount_stripped`. Damit geht keine Bestands-Order mehr
 * verloren — was hier drohte, war kein verzoegerter Retry, sondern ein stiller
 * Totalverlust: `upsertCursor` im Scheduler rueckt unabhaengig vom Ergebnis vor,
 * der abgelehnte Record wird also nie wieder geliefert.
 *
 * Dieser Guard bleibt trotzdem: Er faengt den EXTERNEN Schreibzugriff mit einer
 * sprechenden Meldung ab, bevor TSE- und Kassen-Hooks Nebenwirkungen erzeugen.
 * Der Strip drueben heilt Bestandsdaten, dieser Hook erzieht Clients.
 *
 * Anders als `validateStaffMealExclusivity` braucht dieser Hook KEINEN
 * Vorzustand: Verboten ist der Schreibzugriff selbst, nicht eine Kombination.
 * Genau daran scheiterte die Vorgaengerloesung — sie verglich nur innerhalb des
 * Payloads und sah einen bereits gespeicherten `appliedDiscounts` nicht
 * (panary/panary-core#181).
 */
import type { HookContext } from '@feathersjs/feathers'
import { BadRequest } from '@feathersjs/errors'

import { assertNoLegacyDiscountWrite, type LegacyDiscountWriteInput } from '@panary/orders/domain'

const assertOne = (candidate: LegacyDiscountWriteInput): void => {
  try {
    assertNoLegacyDiscountWrite(candidate)
  } catch (err) {
    throw new BadRequest(err instanceof Error ? err.message : String(err))
  }
}

export const rejectLegacyDiscount = async (context: HookContext): Promise<HookContext> => {
  if (!context.params.provider) return context
  if (context.method !== 'create' && context.method !== 'patch') return context

  const payload = context.data as LegacyDiscountWriteInput | LegacyDiscountWriteInput[]
  for (const candidate of Array.isArray(payload) ? payload : [payload]) {
    if (candidate) assertOne(candidate)
  }
  return context
}
