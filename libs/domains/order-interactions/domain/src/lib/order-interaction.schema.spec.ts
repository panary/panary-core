import { describe, expect, it } from 'vitest'

import {
  DiscountAppliesTo,
  orderInteractionDataSchema,
  OrderChannel,
  OrderInteractionType,
  orderInteractionSchema,
  PaymentStatusAtEvent,
} from './order-interaction.schema'

type SchemaShape = {
  $id?: string
  additionalProperties?: boolean
  required?: string[]
  properties: Record<string, unknown>
}

const cast = (s: unknown) => s as SchemaShape

describe('orderInteractionSchema (Phase 4 — Wide Events)', () => {
  it('hat $id "OrderInteraction"', () => {
    expect(cast(orderInteractionSchema).$id).toBe('OrderInteraction')
  })

  it('verbietet additionalProperties (Schema-strikt)', () => {
    expect(cast(orderInteractionSchema).additionalProperties).toBe(false)
  })

  describe('Enum-Erweiterung', () => {
    it('OrderInteractionType enthaelt alle 8 Event-Typen', () => {
      const values = Object.values(OrderInteractionType)
      expect(values).toEqual([
        'item-delete',
        'order-cancel',
        'discount-applied',
        'price-override',
        'refund',
        'void-after-payment',
        'no-sale-drawer-open',
        'receipt-reprint',
      ])
    })

    it('PaymentStatusAtEvent / OrderChannel / DiscountAppliesTo liefern stabile Enum-Konstanten', () => {
      expect(Object.values(PaymentStatusAtEvent)).toEqual(['OPEN', 'PARTIALLY_PAID', 'PAID'])
      expect(Object.values(OrderChannel)).toEqual(['DINE_IN', 'TAKEAWAY', 'DELIVERY'])
      expect(Object.values(DiscountAppliesTo)).toEqual(['LINE_ITEM', 'ORDER_TOTAL'])
    })
  })

  describe('Backward-Kompatibilitaet', () => {
    it('orderOpenedAt + eventOffsetMs sind NICHT mehr required (Phase 7 — order-lose Events)', () => {
      const required = cast(orderInteractionSchema).required ?? []
      expect(required).not.toContain('orderOpenedAt')
      expect(required).not.toContain('eventOffsetMs')
    })

    it('eventAt + userId + type bleiben Pflichtfelder (Skelett jedes Events)', () => {
      const required = cast(orderInteractionSchema).required ?? []
      expect(required).toContain('eventAt')
      expect(required).toContain('userId')
      expect(required).toContain('type')
    })

    it('orderId bleibt optional (NO_SALE / RECEIPT_REPRINT sind order-los)', () => {
      const required = cast(orderInteractionSchema).required ?? []
      expect(required).not.toContain('orderId')
    })
  })

  describe('Wide-Event-Kontext-Felder (Phase 4)', () => {
    const expectedNewFields = [
      'requestId',
      'shiftId',
      'orderTotalCentsBeforeEvent',
      'orderTotalCentsAfterEvent',
      'paymentStatusAtEvent',
      'customerIdentified',
      'customerLoyaltyTier',
      'orderChannel',
      'edgeAppVersion',
      'posClientVersion',
      'deviceId',
      'posStationName',
      'discountAmountCents',
      'discountPercent',
      'discountReasonCode',
      'discountAppliesTo',
      'priceBeforeCents',
      'priceAfterCents',
      'priceOverrideReason',
      'paymentId',
      'refundAmountCents',
      'refundReasonCode',
      'drawerOpenedReason',
      'originalReceiptId',
      'reprintCount',
    ]

    it.each(expectedNewFields)('Schema-Properties enthalten "%s"', field => {
      expect(cast(orderInteractionSchema).properties).toHaveProperty(field)
    })

    it.each(expectedNewFields)('"%s" ist optional (nicht in `required`)', field => {
      const required = cast(orderInteractionSchema).required ?? []
      expect(required).not.toContain(field)
    })
  })

  describe('orderInteractionDataSchema (POST-Body)', () => {
    it('hat denselben strikten Mode', () => {
      expect(cast(orderInteractionDataSchema).additionalProperties).toBe(false)
    })

    it('nimmt alle neuen Wide-Event-Felder mit', () => {
      const props = cast(orderInteractionDataSchema).properties
      expect(props).toHaveProperty('discountAmountCents')
      expect(props).toHaveProperty('refundAmountCents')
      expect(props).toHaveProperty('drawerOpenedReason')
      expect(props).toHaveProperty('originalReceiptId')
      expect(props).toHaveProperty('paymentStatusAtEvent')
      expect(props).toHaveProperty('requestId')
      expect(props).toHaveProperty('shiftId')
    })
  })
})
