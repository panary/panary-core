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
 * aufgebbar. Dasselbe Muster wie `business_day.age_check_skipped` in
 * `restrict-order-to-business-day.ts` — ein unscharfer Abrechnungskreis ist
 * ein Auswertungsproblem, eine blockierte Kasse ein Betriebsausfall. Der
 * Ausfall wird geloggt, nicht verschwiegen (ADR 0047).
 *
 * Besuchszaehler und Riegel (ADR 0063 Nr. 2 und 4): Der Kreis eines Tisches ist
 * `<Label>#<n>`. Dafuer liest der Hook die Bestellungen des Tisches am
 * Geschaeftstag ueber die Adapter-API. Bringt eine Bestellung den Kreis eines
 * schon geschlossenen Besuchs mit (eine Kasse ohne Verbindung hat nachbestellt,
 * waehrend eine andere kassierte), ordnet er sie dem naechsten Besuch zu und
 * vermerkt das im Journal. Abgelehnt wird nie: Die Bestellung ist bei Ankunft
 * schon produziert, und eine Ablehnung am Outbox-Push waere endgueltig und
 * unbemerkt (TERMINAL).
 */
import type { HookContext, NextFunction } from '@feathersjs/feathers'
import { OrderInteractionType } from '@panary/order-interactions/domain'
import {
  deriveSettlementScope,
  isSettlementScopeOpen,
  isSyntheticSettlementScope,
  parseVisitSettlementScope,
  SETTLEMENT_SCOPE_MAX_LENGTH,
  type SettlementScopeOrderState,
  syntheticSettlementScope,
  visitSettlementScope,
} from '@panary/orders/domain'
import { logger } from '@panary/shared-backend'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function assignSettlementScope() {
  return async (context: HookContext, _next?: NextFunction): Promise<any> => {
    const next = typeof _next === 'function' ? _next : async () => context
    const data = context.data as Record<string, unknown> | undefined

    // `multi: []` — `create` bekommt hier nie ein Array. Der Guard faengt nur
    // den leeren Body ab; den lehnt `validateData` gleich danach ohnehin ab.
    if (!data || typeof data !== 'object' || Array.isArray(data)) return next()

    try {
      data['settlementScope'] = await resolveScope(data, context)
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
 * Ein mitgeschickter Wert hat Vorrang, solange sein Besuch nicht geschlossen
 * ist; sonst wird abgeleitet.
 *
 * Warum ein Client-Wert ueberhaupt zaehlt: Er gibt ihm keine neue Macht. Der
 * Abrechnungskreis leitet sich aus `table` ab, und `table` ist schon heute
 * freier, vom Client gesetzter Text — wer die Gruppierung bestimmen will, tut
 * das ohnehin ueber den Tisch. Dafuer bleibt so ein offline im POS erzeugter
 * Wert stabil, statt beim Hochladen durch einen zweiten ersetzt zu werden.
 *
 * Ein Wert ohne `#<n>` (alter Client, synthetischer Kreis) geht unveraendert
 * durch: Er ist „Besuch 0" und bleibt so grob, wie er entstanden ist.
 *
 * Nach dem Create ist das Feld dicht: `orderPatchResolver` strippt es still,
 * wie `dailySequenceNumber`.
 */
async function resolveScope(data: Record<string, unknown>, context: HookContext): Promise<string> {
  const provided = typeof data['settlementScope'] === 'string' ? (data['settlementScope'] as string).trim() : ''
  // Ein Split erbt den Kreis seiner Quelle (`orders.split`, ADR 0049) — auch wenn
  // der Besuch geschlossen ist. Der Schalter liegt in den Server-Params, ein
  // Client kann ihn nicht setzen.
  if (provided && (context.params as { inheritSettlementScope?: boolean })?.inheritSettlementScope === true) {
    return provided.slice(0, SETTLEMENT_SCOPE_MAX_LENGTH)
  }
  const providedVisit = parseVisitSettlementScope(provided)
  if (provided && !providedVisit) return provided.slice(0, SETTLEMENT_SCOPE_MAX_LENGTH)

  const table = typeof data['table'] === 'string' ? (data['table'] as string) : null
  const tableOrders = table || providedVisit ? await loadTableOrders(data, context, table, provided) : []

  if (providedVisit) {
    // Unbekannt oder offen: Der Kreis gilt. Unbekannt heisst meist, eine
    // zweite Kasse hat denselben Besuch gerade eroeffnet.
    if (
      tableOrders === null ||
      !tableOrders.some(order => order.settlementScope === provided) ||
      isSettlementScopeOpen(provided, tableOrders)
    ) {
      return provided.slice(0, SETTLEMENT_SCOPE_MAX_LENGTH)
    }
    const reassigned = visitSettlementScope(providedVisit.label, tableOrders) ?? deriveFallback(data, context)
    await recordReassignment(data, context, provided, reassigned)
    return reassigned
  }

  const scope = deriveSettlementScope({ ...scopeInput(data, context), tableOrders: tableOrders ?? [] })
  if (table?.trim() && isSyntheticSettlementScope(scope)) {
    // Der Tisch verliert seine Klammer, die Kasse arbeitet weiter (ADR 0063 Nr. 4).
    logger.warn({
      message: 'Tisch-Label mit Besuch passt nicht in 50 Zeichen — synthetischer Abrechnungskreis',
      event: 'order.settlement_scope_fallback',
      reason: 'visit_scope_too_long',
      settlementScope: scope,
      tableLength: table.trim().length,
      locationId: data['locationId'],
      businessDayId: data['businessDayId'],
    })
  }
  return scope
}

function scopeInput(data: Record<string, unknown>, context: HookContext) {
  return {
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
  }
}

function deriveFallback(data: Record<string, unknown>, context: HookContext): string {
  const scope = syntheticSettlementScope(scopeInput(data, context))
  logger.warn({
    message: 'Naechster Besuch passt nicht in 50 Zeichen — synthetischer Abrechnungskreis',
    event: 'order.settlement_scope_fallback',
    reason: 'visit_scope_too_long',
    settlementScope: scope,
    locationId: data['locationId'],
    businessDayId: data['businessDayId'],
  })
  return scope
}

/**
 * Die Bestellungen des Tisches am Geschaeftstag, dazu die des mitgeschickten
 * Kreises (falls der Tisch inzwischen verlegt wurde). `null`, wenn das nicht
 * ermittelbar ist — dann gilt ein mitgeschickter Wert unveraendert und die
 * Ableitung behandelt den Tisch als unbesucht.
 *
 * Ueber die Adapter-API, intern und mit explizitem Mandanten und Standort:
 * Ohne `params.user` stempelt `multiTenancy()` keinen Filter, und der Edge
 * fuehrt ohnehin genau eine Filiale.
 */
async function loadTableOrders(
  data: Record<string, unknown>,
  context: HookContext,
  table: string | null,
  provided: string,
): Promise<SettlementScopeOrderState[] | null> {
  const businessDayId = typeof data['businessDayId'] === 'string' ? data['businessDayId'] : null
  const tenantId = typeof data['tenantId'] === 'string' ? data['tenantId'] : null
  const locationId = typeof data['locationId'] === 'string' ? data['locationId'] : null
  if (!businessDayId || !tenantId || !locationId) return null

  const matches: Record<string, unknown>[] = []
  if (table) matches.push({ table })
  if (provided) matches.push({ settlementScope: provided })

  try {
    const found = (await context.app.service('orders').find({
      provider: undefined,
      paginate: false,
      query: {
        tenantId,
        locationId,
        businessDayId,
        $or: matches,
        $select: ['_id', 'settlementScope', 'status'],
      },
    } as any)) as SettlementScopeOrderState[]
    return Array.isArray(found) ? found : null
  } catch (error) {
    logger.warn({
      message: 'Kreise des Tisches nicht lesbar — Abrechnungskreis ohne Besuchsabgleich',
      event: 'order.settlement_scope_lookup_failed',
      locationId,
      businessDayId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Vermerkt die Umsetzung im Journal: als Eintrag fuer `createOrderInteractions()`
 * (after.create), denn erst dann steht die Bestellung — vorher gaebe es nichts,
 * worauf `orderId` zeigen koennte.
 *
 * Bediener ist der Ersteller der Bestellung (`creationContext.createdBy`), nicht
 * `params.user`: Am POS und beim Outbox-Replay ist das der Geraete-User
 * `device:<uuid>`, kein Mensch (ADR 0052). Ohne gueltigen Bediener kein Eintrag
 * (ADR 0048), nur die Logzeile — sie traegt auch beide Kreise, die das Journal
 * mangels Feldern nicht fuehrt.
 */
async function recordReassignment(
  data: Record<string, unknown>,
  context: HookContext,
  from: string,
  to: string,
): Promise<void> {
  const userId = await resolveOperator(data, context)

  logger.warn({
    message: 'Bestellung kam mit dem Kreis eines geschlossenen Besuchs — dem naechsten Besuch zugeordnet',
    event: 'order.settlement_scope_reassigned',
    settlementScopeRequested: from.slice(0, SETTLEMENT_SCOPE_MAX_LENGTH),
    settlementScope: to,
    orderId: data['_id'],
    locationId: data['locationId'],
    businessDayId: data['businessDayId'],
    journal: userId !== null,
  })
  if (!userId) return

  const interaction: Record<string, unknown> = {
    type: OrderInteractionType.SETTLEMENT_SCOPE_REASSIGNED,
    userId,
    businessDayId: data['businessDayId'],
    eventAt: new Date().toISOString(),
    tenantId: data['tenantId'],
    locationId: data['locationId'],
  }
  // Nur setzen, wenn vorhanden: ein Schluessel mit `undefined` faellt am
  // Journal-Validator als „must be string" durch.
  if (typeof data['recordingDate'] === 'string') interaction['orderOpenedAt'] = data['recordingDate']

  const params = context.params as { orderInteractions?: unknown[] }
  params.orderInteractions = [...(Array.isArray(params.orderInteractions) ? params.orderInteractions : []), interaction]
}

/**
 * Der Ersteller der Bestellung, wenn er zu ihrem Mandanten gehoert — sonst
 * `null`. Dieselbe Pruefung wie beim Split-Journal (`resolveSplitOperator`):
 * `createdBy` setzt der Client, und ein Journal-Eintrag mit fremdem Bediener
 * waere schlimmer als keiner.
 */
async function resolveOperator(data: Record<string, unknown>, context: HookContext): Promise<string | null> {
  const userId = (data['creationContext'] as { createdBy?: unknown } | null | undefined)?.createdBy
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) return null
  try {
    const operator = (await context.app.service('users').get(userId, { provider: undefined } as any)) as {
      tenantId?: string | null
    }
    return operator?.tenantId === data['tenantId'] ? userId : null
  } catch {
    return null
  }
}
