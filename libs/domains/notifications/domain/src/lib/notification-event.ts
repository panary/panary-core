/**
 * Alle bekannten Notification-Event-Typen. Wird zentral hier definiert, damit
 * Backend (`sender.ts`, `email-templates.ts`) und Frontend (Preferences-Page,
 * Drawer-Übersetzung) gegen dieselbe Quelle arbeiten.
 *
 * Namenskonvention: `<domain>.<state>` — `domain` ist die Quelle der Änderung
 * (`vacation`, `swap`, …), `state` der ausgelöste Zustand. Vergangenheitsform
 * (`submitted`, `approved`) bzw. präsente Tatsache (`status_changed`).
 *
 * **Erweitern statt umbenennen** — User-Preferences speichern den Event-Typ
 * als String. Eine Umbenennung würde stille Preference-Verluste verursachen.
 */
export const NotificationEventType = {
  VACATION_SUBMITTED: 'vacation.submitted',
  VACATION_REVIEWED: 'vacation.reviewed',
  VACATION_CANCELLED: 'vacation.cancelled',

  SWAP_PROPOSED: 'swap.proposed',
  SWAP_CLAIMED: 'swap.claimed',
  SWAP_REVIEWED: 'swap.reviewed',
  SWAP_CANCELLED: 'swap.cancelled',

  OPEN_SHIFT_APPLIED: 'open-shift.applied',
  OPEN_SHIFT_REVIEWED: 'open-shift.reviewed',

  ORDER_CREATED: 'order.created',
  ORDER_STATUS_CHANGED: 'order.status_changed',

  /**
   * Stornoanalyse: Mitarbeiter hat eine konfigurierte Storno-Schwelle ueberschritten.
   * Adressat: TENANT_OWNER + TENANT_MANAGER der betroffenen Location.
   * Erzeugt durch `evaluateFraudRules()` nach Sync-Push.
   */
  FRAUD_ALERT_TRIGGERED: 'fraud.alert_triggered',
} as const

export type NotificationEventType = (typeof NotificationEventType)[keyof typeof NotificationEventType]

/**
 * Schweregrad für UI-Darstellung (Farbe der Status-Pille, Icon). Wirkt sich
 * nicht auf Zustellung aus — die Channel-Wahl steckt in den Preferences.
 */
export const NotificationSeverity = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
} as const

export type NotificationSeverity = (typeof NotificationSeverity)[keyof typeof NotificationSeverity]

/**
 * Kategorisierung für die Preferences-Page (gruppiert die Toggles).
 */
export const NotificationCategory = {
  PERSONAL: 'personal',
  ORDERS: 'orders',
} as const

export type NotificationCategory = (typeof NotificationCategory)[keyof typeof NotificationCategory]

/**
 * Statische Metadaten je Event-Typ — Default-Aktivierung pro Channel,
 * Kategorie für UI-Gruppierung, Human-readable Label.
 *
 * Default-Logik:
 *  - `inApp: true` für alle Events (User hat immer In-App-Sichtbarkeit)
 *  - `email: true` für „review/result"-Events (Approve/Reject/Cancel) — Empfänger erwartet eine Antwort
 *  - `email: false` für reine „eingegangen"-Events bei Managern (sonst Spam)
 *  - `push: true` für review-Events; bei Push fehlt der Subscription-Fallback (kein Versuch wenn kein Subscribe)
 */
export interface NotificationEventMeta {
  category: NotificationCategory
  label: string
  defaults: { inApp: boolean; email: boolean; push: boolean }
}

export const NOTIFICATION_EVENT_META: Record<NotificationEventType, NotificationEventMeta> = {
  [NotificationEventType.VACATION_SUBMITTED]: {
    category: NotificationCategory.PERSONAL,
    label: 'Urlaubsantrag eingereicht',
    defaults: { inApp: true, email: false, push: true },
  },
  [NotificationEventType.VACATION_REVIEWED]: {
    category: NotificationCategory.PERSONAL,
    label: 'Urlaubsantrag genehmigt / abgelehnt',
    defaults: { inApp: true, email: true, push: true },
  },
  [NotificationEventType.VACATION_CANCELLED]: {
    category: NotificationCategory.PERSONAL,
    label: 'Urlaubsantrag storniert',
    defaults: { inApp: true, email: false, push: false },
  },
  [NotificationEventType.SWAP_PROPOSED]: {
    category: NotificationCategory.PERSONAL,
    label: 'Schichttausch angeboten',
    defaults: { inApp: true, email: false, push: true },
  },
  [NotificationEventType.SWAP_CLAIMED]: {
    category: NotificationCategory.PERSONAL,
    label: 'Schichttausch beansprucht',
    defaults: { inApp: true, email: false, push: true },
  },
  [NotificationEventType.SWAP_REVIEWED]: {
    category: NotificationCategory.PERSONAL,
    label: 'Schichttausch genehmigt / abgelehnt',
    defaults: { inApp: true, email: true, push: true },
  },
  [NotificationEventType.SWAP_CANCELLED]: {
    category: NotificationCategory.PERSONAL,
    label: 'Schichttausch zurückgezogen',
    defaults: { inApp: true, email: false, push: false },
  },
  [NotificationEventType.OPEN_SHIFT_APPLIED]: {
    category: NotificationCategory.PERSONAL,
    label: 'Bewerbung auf offene Schicht',
    defaults: { inApp: true, email: false, push: true },
  },
  [NotificationEventType.OPEN_SHIFT_REVIEWED]: {
    category: NotificationCategory.PERSONAL,
    label: 'Offene Schicht genehmigt / abgelehnt',
    defaults: { inApp: true, email: true, push: true },
  },
  [NotificationEventType.ORDER_CREATED]: {
    category: NotificationCategory.ORDERS,
    label: 'Neue Bestellung eingegangen',
    defaults: { inApp: true, email: false, push: false },
  },
  [NotificationEventType.ORDER_STATUS_CHANGED]: {
    category: NotificationCategory.ORDERS,
    label: 'Bestellstatus geändert',
    defaults: { inApp: true, email: false, push: false },
  },
  [NotificationEventType.FRAUD_ALERT_TRIGGERED]: {
    // Bewusst in der ORDERS-Kategorie — die Preferences-Page gruppiert
    // tenant-weit, nicht filial-spezifisch. Spaeter ggf. eigene Kategorie
    // 'security'. Default: nur In-App, weil Stornoanalyse-Alerts
    // chronisch sein koennen und E-Mail/Push spammig waeren.
    category: NotificationCategory.ORDERS,
    label: 'Storno-Schwellenwert ueberschritten',
    defaults: { inApp: true, email: false, push: false },
  },
}
