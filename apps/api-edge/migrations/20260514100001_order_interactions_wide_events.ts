import type { Knex } from 'knex'

/**
 * Phase 4 der Stornoanalyse-Roadmap: erweitert `order-interactions` um
 * Wide-Event-Kontext-Felder, damit die Cloud-Aggregation spaeter Storno-
 * Muster differenzierter erkennen kann (DISCOUNT_APPLIED, PRICE_OVERRIDE,
 * REFUND, NO_SALE etc.).
 *
 * Strikt additiv — alle Spalten nullable. Bestehende Records bleiben gueltig,
 * aelterer Edge-Code (vor Phase 5–7) sendet weiter die alten Felder.
 *
 * Indizes:
 *  - `type` (Filter pro Event-Typ in der Cloud-Aggregation)
 *  - kombiniert `tenantId+eventAt` ist bereits in
 *    20260401000001_add_missing_indexes.ts oder via createTable-Default;
 *    pruefen wir hier nicht. Falls ein zukuenftiger Performance-Check zeigt,
 *    dass der Index fehlt → Folge-Migration.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order-interactions', table => {
    // Wide-Event-Kontext
    table.string('requestId').nullable()
    table.string('shiftId').nullable()
    table.integer('orderTotalCentsBeforeEvent').nullable()
    table.integer('orderTotalCentsAfterEvent').nullable()
    table.string('paymentStatusAtEvent').nullable()
    table.boolean('customerIdentified').nullable()
    table.string('customerLoyaltyTier').nullable()
    table.string('orderChannel').nullable()
    table.string('edgeAppVersion').nullable()
    table.string('posClientVersion').nullable()
    table.string('deviceId').nullable()
    table.string('posStationName').nullable()

    // DISCOUNT_APPLIED
    table.integer('discountAmountCents').nullable()
    table.float('discountPercent').nullable()
    table.string('discountReasonCode').nullable()
    table.string('discountAppliesTo').nullable()

    // PRICE_OVERRIDE
    table.integer('priceBeforeCents').nullable()
    table.integer('priceAfterCents').nullable()
    table.string('priceOverrideReason').nullable()

    // REFUND / VOID_AFTER_PAYMENT
    table.string('paymentId').nullable()
    table.integer('refundAmountCents').nullable()
    table.string('refundReasonCode').nullable()

    // NO_SALE_DRAWER_OPEN
    table.string('drawerOpenedReason').nullable()

    // RECEIPT_REPRINT
    table.string('originalReceiptId').nullable()
    table.integer('reprintCount').nullable()
  })

  // Filter-Index pro Event-Typ — die Cloud-Aggregation filtert haeufig auf
  // `type IN (...)` (z.B. nur Discounts oder nur Refunds anzeigen).
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS "idx_order_interactions_type" ON "order-interactions" (type)',
  )

  // Schicht-spezifische Aggregation (Phase 8) — sparse-aequivalent: SQLite
  // indiziert auch NULL-Eintraege, das ist akzeptabel da `shiftId` nur in
  // einer Untermenge gesetzt ist.
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS "idx_order_interactions_shift" ON "order-interactions" (shiftId)',
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS "idx_order_interactions_shift"')
  await knex.raw('DROP INDEX IF EXISTS "idx_order_interactions_type"')
  await knex.schema.alterTable('order-interactions', table => {
    table.dropColumn('requestId')
    table.dropColumn('shiftId')
    table.dropColumn('orderTotalCentsBeforeEvent')
    table.dropColumn('orderTotalCentsAfterEvent')
    table.dropColumn('paymentStatusAtEvent')
    table.dropColumn('customerIdentified')
    table.dropColumn('customerLoyaltyTier')
    table.dropColumn('orderChannel')
    table.dropColumn('edgeAppVersion')
    table.dropColumn('posClientVersion')
    table.dropColumn('deviceId')
    table.dropColumn('posStationName')
    table.dropColumn('discountAmountCents')
    table.dropColumn('discountPercent')
    table.dropColumn('discountReasonCode')
    table.dropColumn('discountAppliesTo')
    table.dropColumn('priceBeforeCents')
    table.dropColumn('priceAfterCents')
    table.dropColumn('priceOverrideReason')
    table.dropColumn('paymentId')
    table.dropColumn('refundAmountCents')
    table.dropColumn('refundReasonCode')
    table.dropColumn('drawerOpenedReason')
    table.dropColumn('originalReceiptId')
    table.dropColumn('reprintCount')
  })
}
