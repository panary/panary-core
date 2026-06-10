import { AppResource } from './permissions'

describe('AppResource — Phase 6 (BRAND + RESERVATION)', () => {
  describe('Neue AppResources', () => {
    it('exportiert BRANDS mit Wert "brands"', () => {
      expect(AppResource.BRANDS).toBe('brands')
    })

    it('exportiert RESERVATIONS mit Wert "reservations"', () => {
      expect(AppResource.RESERVATIONS).toBe('reservations')
    })

    it('exportiert RESERVATION_TABLES mit Wert "reservation-tables"', () => {
      expect(AppResource.RESERVATION_TABLES).toBe('reservation-tables')
    })

    it('exportiert RESERVABLE_SLOTS mit Wert "reservable-slots"', () => {
      expect(AppResource.RESERVABLE_SLOTS).toBe('reservable-slots')
    })
  })

  describe('Regression: bestehende AppResources unverändert', () => {
    it('USERS bleibt "users"', () => {
      expect(AppResource.USERS).toBe('users')
    })

    it('PRODUCTS bleibt "products"', () => {
      expect(AppResource.PRODUCTS).toBe('products')
    })

    it('STOREFRONT_PUBLISH bleibt "storefront-publish"', () => {
      expect(AppResource.STOREFRONT_PUBLISH).toBe('storefront-publish')
    })

    it('STOREFRONT_PUBLISH_BRAND bleibt "storefront-publish-brand"', () => {
      expect(AppResource.STOREFRONT_PUBLISH_BRAND).toBe('storefront-publish-brand')
    })

    it('STOREFRONT_PUBLISH_ROLLBACK bleibt "storefront-publish-rollback"', () => {
      expect(AppResource.STOREFRONT_PUBLISH_ROLLBACK).toBe('storefront-publish-rollback')
    })

    it('STOREFRONT_PREVIEW_TOKEN bleibt "storefront-preview-token"', () => {
      expect(AppResource.STOREFRONT_PREVIEW_TOKEN).toBe('storefront-preview-token')
    })
  })
})
