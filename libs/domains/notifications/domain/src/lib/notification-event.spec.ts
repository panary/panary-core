import { NOTIFICATION_EVENT_META, NotificationCategory, NotificationEventType } from './notification-event'

/**
 * `NOTIFICATION_EVENT_META` ist als `Record<NotificationEventType, …>` typisiert
 * — ein fehlender Eintrag ist damit schon ein Compile-Fehler. Der Test haelt
 * die Invariante trotzdem zur Laufzeit fest: Wird der Record-Typ spaeter
 * gelockert (`Partial<…>`, Index-Signatur), faellt es hier auf statt erst beim
 * Nutzer, dessen Benachrichtigung ohne Label und ohne Default-Channels
 * ankommt.
 */
describe('NOTIFICATION_EVENT_META', () => {
  it('kennt jeden Event-Typ', () => {
    for (const eventType of Object.values(NotificationEventType)) {
      expect(NOTIFICATION_EVENT_META[eventType], eventType).toBeDefined()
    }
  })

  it('gibt jedem Event ein Label und eine Kategorie', () => {
    for (const [eventType, meta] of Object.entries(NOTIFICATION_EVENT_META)) {
      expect(meta.label.length, eventType).toBeGreaterThan(0)
      expect(Object.values(NotificationCategory), eventType).toContain(meta.category)
    }
  })

  it('haelt In-App fuer jeden Event an — es ist der Fallback-Kanal', () => {
    // E-Mail und Push koennen fehlschlagen oder abbestellt sein; die In-App-Row
    // ist die einzige Zustellung, die immer ankommt.
    for (const [eventType, meta] of Object.entries(NOTIFICATION_EVENT_META)) {
      expect(meta.defaults.inApp, eventType).toBe(true)
    }
  })
})

describe('FISCAL_REPORTING_DUE', () => {
  it('liegt in der Fiskal-Kategorie, nicht bei Billing', () => {
    // Es geht um eine steuerliche Pflicht des Betriebs, nicht um sein Abo.
    expect(NOTIFICATION_EVENT_META[NotificationEventType.FISCAL_REPORTING_DUE].category).toBe(
      NotificationCategory.CLOSING,
    )
  })

  it('ist auf allen Kanaelen vorbelegt — gesetzliche Frist', () => {
    expect(NOTIFICATION_EVENT_META[NotificationEventType.FISCAL_REPORTING_DUE].defaults).toEqual({
      inApp: true,
      email: true,
      push: true,
    })
  })
})
