/**
 * Assign-Settlement-Scope-Hook.
 *
 * Stempelt jeder neuen Bestellung ihren Abrechnungskreis (`settlementScope`,
 * DSFinV-K `ABRECHNUNGSKREIS`). Das ist die Klammer, ueber die ein Pruefer
 * zusammengehoerende Vorgaenge eines Tisches nachvollzieht — und die einzige,
 * die die DSFinV-K dafuer vorsieht (Tz. 2.7.1, 3.1.2.2).
 *
 * Laeuft NACH `restrictOrderToBusinessDay()` und `assignDailySequenceNumber()`:
 * Der synthetische Wert fuer Bestellungen ohne Tisch wird aus Standort,
 * Geschaeftstag und Vorgangsnummer gebaut, und die beiden letzten stempeln
 * diese Hooks. Laeuft VOR `validateData` — das Feld ist im Schema Pflicht.
 *
 * 🚨 Der Hook wirft nie. Ein Pflichtfeld mit serverseitigem Default ist ein
 * Fiskal-Gate: Schluege die Ableitung fehl, waere keine Bestellung mehr
 * aufgebbar. Die Risiko-Asymmetrie ist eindeutig (ADR 0032, wie bei
 * `business_day.max_open_hours_fallback`) — ein unscharfer Abrechnungskreis
 * ist ein Auswertungsproblem, eine blockierte Kasse ein Betriebsausfall.
 * Der Ausfall wird geloggt, nicht verschwiegen.
 */
import type { HookContext, NextFunction } from '@feathersjs/feathers'
import { logger } from '@panary/shared-backend'
import { deriveSettlementScope, SETTLEMENT_SCOPE_MAX_LENGTH, syntheticSettlementScope } from '@panary/orders/domain'

export function assignSettlementScope() {
  return async (context: HookContext, _next?: NextFunction): Promise<any> => {
    const next = typeof _next === 'function' ? _next : async () => context
    const data = context.data as Record<string, unknown> | undefined

    // `multi: []` — `create` bekommt hier nie ein Array. Der Guard faengt nur
    // den leeren Body ab; den lehnt `validateData` gleich danach ohnehin ab.
    if (!data || typeof data !== 'object' || Array.isArray(data)) return next()

    try {
      data['settlementScope'] = resolveScope(data, context)
    } catch (error) {
      // Fail-open: lieber ein grob synthetischer Abrechnungskreis als eine
      // Kasse, die keine Bestellung mehr annimmt.
      const fallback = syntheticSettlementScope({ orderId: typeof data['_id'] === 'string' ? data['_id'] : null })
      data['settlementScope'] = fallback

      logger.error({
        message: 'Abrechnungskreis konnte nicht abgeleitet werden — synthetischer Ersatzwert gesetzt',
        event: 'order.settlement_scope_fallback',
        settlementScope: fallback,
        locationId: data['locationId'],
        businessDayId: data['businessDayId'],
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return next()
  }
}

/**
 * Ein bereits mitgeschickter Wert hat Vorrang, sonst wird abgeleitet.
 *
 * Warum ein Client-Wert ueberhaupt zaehlt: Er gibt ihm keine neue Macht. Der
 * Abrechnungskreis leitet sich aus `table` ab, und `table` ist schon heute
 * freier, vom Client gesetzter Text — wer die Gruppierung bestimmen will, tut
 * das ohnehin ueber den Tisch. Dafuer bleibt so ein offline im POS erzeugter
 * Wert stabil, statt beim Hochladen durch einen zweiten ersetzt zu werden.
 *
 * Nach dem Create ist das Feld dicht: `orderPatchResolver` strippt es still,
 * wie `dailySequenceNumber`.
 */
function resolveScope(data: Record<string, unknown>, context: HookContext): string {
  const provided = typeof data['settlementScope'] === 'string' ? (data['settlementScope'] as string).trim() : ''
  if (provided) return provided.slice(0, SETTLEMENT_SCOPE_MAX_LENGTH)

  return deriveSettlementScope({
    table: typeof data['table'] === 'string' ? (data['table'] as string) : null,
    // `multiTenancy()` stempelt `locationId` in `around.all` und damit vor
    // diesem Hook. Der Fallback auf den Nutzer-Kontext greift nur, wenn der
    // Stempel ausgeblieben ist — dann traegt der synthetische Wert lieber den
    // Standort aus dem Token als `noloc`.
    locationId:
      (typeof data['locationId'] === 'string' ? (data['locationId'] as string) : null) ??
      ((context.params as any)?.user?.locationId as string | undefined) ??
      null,
    businessDayId: typeof data['businessDayId'] === 'string' ? (data['businessDayId'] as string) : null,
    dailySequenceNumber:
      typeof data['dailySequenceNumber'] === 'number' ? (data['dailySequenceNumber'] as number) : null,
    orderId: typeof data['_id'] === 'string' ? (data['_id'] as string) : null,
  })
}
