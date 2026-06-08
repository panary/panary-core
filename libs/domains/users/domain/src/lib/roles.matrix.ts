import { UserSystemRole } from './user.schema'
import { AppAction, AppResource, AppAbility } from './permissions'

// Wir exportieren den Typ, damit wir ihn im Hook nutzen können (Clean Code)
export type PermissionRule = { resource: AppResource; action: AppAction | AppAction[] } | AppAbility

// Wir erzwingen mit 'Record<...>', dass ALLE Keys vorhanden sein müssen
export const RolePermissions: Record<UserSystemRole, PermissionRule[]> = {
  // =======================================================
  // PLATFORM PERMISSIONS
  // =======================================================
  [UserSystemRole.PLATFORM_OWNER]: [
    // Always-on über alle Ressourcen. Im authorize-Hook explizit per Bypass behandelt.
    // Diese Liste dient als Dokumentation der Mindest-Rechte (falls Bypass entfällt).
    { resource: AppResource.SYSTEM, action: AppAction.MANAGE },
    { resource: AppResource.USERS, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_TENANTS, action: AppAction.MANAGE },
    // Tenant-First-Class (Phase 1+ Migration): kanonischer Tenant-Service mit
    // Subscription/Billing/TSE/Branding-Stamm-Daten. Plan-Katalog ist eigene
    // Collection. Audit-Trail Append-Only.
    { resource: AppResource.TENANTS, action: AppAction.MANAGE },
    { resource: AppResource.SUBSCRIPTION_PLANS, action: AppAction.MANAGE },
    // Subscription-Lifecycle gegen den BillingProvider (Mollie).
    { resource: AppResource.PLATFORM_SUBSCRIPTIONS, action: AppAction.MANAGE },
    // Abo-Rechnungs-Store (§14-UStG, Panary → Tenant). Platform verwaltet voll.
    { resource: AppResource.PLATFORM_SUBSCRIPTION_INVOICES, action: AppAction.MANAGE },
    // App-seitige Subscription-Promo-Codes (globaler Store). Platform verwaltet voll.
    { resource: AppResource.PLATFORM_PROMO_CODES, action: AppAction.MANAGE },
    // Tenant-Self-Service-Aktionen — Platform-Bypass per Impersonation moeglich.
    { resource: AppResource.TENANT_SUBSCRIPTION_ACTIONS, action: AppAction.MANAGE },
    // Vier-Augen-Antraege: Owner approved (Hook erzwingt approver !== requester).
    { resource: AppResource.PLATFORM_SUBSCRIPTION_CHANGE_REQUESTS, action: AppAction.MANAGE },
    { resource: AppResource.TENANT_AUDIT_TRAIL, action: AppAction.READ },
    // OoS-Follow-up: DSGVO-Export, Owner-Transfer, VIES-Validation (Wellen B-E).
    { resource: AppResource.GDPR_TENANT_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.GDPR_SELF_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.TENANT_OWNER_TRANSFER, action: AppAction.MANAGE },
    { resource: AppResource.VAT_VALIDATION_CACHE, action: AppAction.MANAGE },
    { resource: AppResource.EXTERNAL_VIES_LOOKUP, action: AppAction.MANAGE },
    // OoS-Item-7: Tenant-Logo-Upload (Cross-Tenant fuer Plattform-Admin).
    { resource: AppResource.TENANT_BRANDING_ASSET, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_IMPERSONATION, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_IMPERSONATION_EVENTS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_SYSTEM_HEALTH, action: AppAction.READ },
    { resource: AppResource.PLATFORM_BUSINESS_METRICS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_TENANT_HEALTH, action: AppAction.READ },
    { resource: AppResource.PLATFORM_ALERTS, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_EVENT_STATS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_CONFIG, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_PUSH_SUBSCRIPTION, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_CLOUD_CONNECTIONS, action: AppAction.READ },
    { resource: AppResource.TENANT_GRANTS, action: AppAction.MANAGE },
    // Globale Identitaets-Collection (E-Mail-Login). Owner verwaltet Accounts
    // plattformweit (Dienstleister-Einladungen, Passwort-Reset-Support).
    { resource: AppResource.ACCOUNTS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Tenant-Audit-Events: Owner hat Bypass; Eintrag dient als Dokumentation
    // (siehe authorize-Hook). PLATFORM_SUPPORT bekommt KEINEN Direktzugriff —
    // Support liest Tenant-Audits nur via Cloud-Impersonation.
    { resource: AppResource.AUDIT_EVENTS, action: AppAction.READ },
    { resource: AppResource.AUDIT_EVENT_REDACTIONS, action: AppAction.READ },
    // Globaler Lieferanten-Katalog (Phase 2): Plattform-Owner pflegt master.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.MANAGE },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: AppAction.MANAGE },
    // Tenant-Settings: PLATFORM_OWNER aktiviert das KI-Wareneingang-Feature pro Tenant.
    { resource: AppResource.TENANT_SETTINGS, action: AppAction.MANAGE },
    // KI-Wareneingang-Audit (cross-tenant fuer Plattform-Reports).
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.SYNC_REJECTS, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT_DAILY, action: AppAction.READ },
    // Cloud-getriggerter Sofort-Sync — explizit dokumentiert, der Bypass im
    // authorize-Hook deckt diesen Eintrag ohnehin ab.
    { resource: AppResource.SYNC_TRIGGERS, action: AppAction.CREATE },
    // Phase 6 — Brand- und Reservierungs-Schicht. Owner hat strukturellen
    // Bypass; Eintraege dienen der Dokumentation der Mindest-Rechte.
    { resource: AppResource.BRANDS, action: AppAction.MANAGE },
    { resource: AppResource.RESERVATIONS, action: AppAction.MANAGE },
    { resource: AppResource.RESERVATION_TABLES, action: AppAction.MANAGE },
    { resource: AppResource.RESERVABLE_SLOTS, action: AppAction.MANAGE },
  ],

  [UserSystemRole.PLATFORM_ADMIN]: [
    // Always-on Lesen über Plattform-Ressourcen, Schreiben in fremde Tenants nur per Switch.
    { resource: AppResource.USERS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: AppAction.READ },
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },
    { resource: AppResource.SYSTEM, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_TENANTS, action: AppAction.MANAGE },
    // Tenant-First-Class (Phase 1+ Migration): wie PLATFORM_OWNER.
    { resource: AppResource.TENANTS, action: AppAction.MANAGE },
    { resource: AppResource.SUBSCRIPTION_PLANS, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_SUBSCRIPTIONS, action: AppAction.MANAGE },
    // Abo-Rechnungs-Store — wie PLATFORM_OWNER (voller CRUD).
    { resource: AppResource.PLATFORM_SUBSCRIPTION_INVOICES, action: AppAction.MANAGE },
    // App-seitige Subscription-Promo-Codes — wie PLATFORM_OWNER (voller CRUD).
    { resource: AppResource.PLATFORM_PROMO_CODES, action: AppAction.MANAGE },
    // Tenant-Self-Service-Aktionen — Admin kann via Impersonation agieren.
    { resource: AppResource.TENANT_SUBSCRIPTION_ACTIONS, action: AppAction.MANAGE },
    // Vier-Augen-Antraege: ADMIN darf stellen + lesen, aber NICHT approven
    // (approve-Custom-Method prueft on top, dass nur PLATFORM_OWNER signiert).
    {
      resource: AppResource.PLATFORM_SUBSCRIPTION_CHANGE_REQUESTS,
      action: [AppAction.READ, AppAction.CREATE],
    },
    { resource: AppResource.TENANT_AUDIT_TRAIL, action: AppAction.READ },
    // OoS-Follow-up: wie PLATFORM_OWNER.
    { resource: AppResource.GDPR_TENANT_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.GDPR_SELF_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.TENANT_OWNER_TRANSFER, action: AppAction.MANAGE },
    { resource: AppResource.VAT_VALIDATION_CACHE, action: AppAction.MANAGE },
    { resource: AppResource.EXTERNAL_VIES_LOOKUP, action: AppAction.MANAGE },
    // OoS-Item-7: Tenant-Logo-Upload (Cross-Tenant fuer Plattform-Admin).
    { resource: AppResource.TENANT_BRANDING_ASSET, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_IMPERSONATION, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_IMPERSONATION_EVENTS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_SYSTEM_HEALTH, action: AppAction.READ },
    { resource: AppResource.PLATFORM_BUSINESS_METRICS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_TENANT_HEALTH, action: AppAction.READ },
    { resource: AppResource.PLATFORM_ALERTS, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.PLATFORM_EVENT_STATS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_CONFIG, action: AppAction.READ },
    { resource: AppResource.PLATFORM_PUSH_SUBSCRIPTION, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_CLOUD_CONNECTIONS, action: AppAction.READ },
    { resource: AppResource.TENANT_GRANTS, action: AppAction.READ },
    { resource: AppResource.ACCOUNTS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Globaler Lieferanten-Katalog (Phase 2): Plattform-Admin curated.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.MANAGE },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: AppAction.MANAGE },
    // Plattform-Theme-Katalog: PLATFORM_ADMIN kuratiert ihn (PLATFORM_OWNER bypasst ohnehin).
    { resource: AppResource.STOREFRONT_THEME_CATALOG, action: AppAction.MANAGE },
    // Storefront-Publish: Admin darf manuell publizieren (Operator-Eingriff) und Status lesen.
    { resource: AppResource.STOREFRONT_PUBLISH, action: [AppAction.CREATE, AppAction.READ] },
    // Storefront-Preview-Token (Phase 4 PUBW-05): Admin darf signierte Preview-Links
    // fuer Tenants erzeugen (Support-/Operator-Eingriff).
    { resource: AppResource.STOREFRONT_PREVIEW_TOKEN, action: AppAction.CREATE },
    // Tenant-Settings darf der Admin lesen (zur Diagnose), aber nicht aendern.
    { resource: AppResource.TENANT_SETTINGS, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.SYNC_REJECTS, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT_DAILY, action: AppAction.READ },
    // Phase 6 — Brand- und Reservierungs-Schicht. Operator-Eingriff bei
    // Tenant-Support (z.B. Reservierung manuell stornieren).
    { resource: AppResource.BRANDS, action: AppAction.MANAGE },
    { resource: AppResource.RESERVATIONS, action: AppAction.MANAGE },
    { resource: AppResource.RESERVATION_TABLES, action: AppAction.MANAGE },
    { resource: AppResource.RESERVABLE_SLOTS, action: AppAction.MANAGE },
  ],

  [UserSystemRole.PLATFORM_SUPPORT]: [
    // Pro-Tenant Opt-in via Impersonation. Always-on nur Selbst-Verwaltung + Lese-Basics.
    { resource: AppResource.USERS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: AppAction.READ },
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.SYSTEM, action: AppAction.READ },
    { resource: AppResource.PLATFORM_TENANTS, action: AppAction.READ },
    // Tenant-First-Class (Phase 1+ Migration): Support liest, kein Schreibzugriff.
    { resource: AppResource.TENANTS, action: AppAction.READ },
    { resource: AppResource.SUBSCRIPTION_PLANS, action: AppAction.READ },
    // Support sieht Subscription-Status read-only (Diagnose), kein Lifecycle-Eingriff.
    { resource: AppResource.PLATFORM_SUBSCRIPTIONS, action: AppAction.READ },
    // Abo-Rechnungen read-only zur Diagnose (Billing-Support).
    { resource: AppResource.PLATFORM_SUBSCRIPTION_INVOICES, action: AppAction.READ },
    // Promo-Codes read-only zur Diagnose (Billing-Support).
    { resource: AppResource.PLATFORM_PROMO_CODES, action: AppAction.READ },
    // Tenant-Self-Service-Aktionen: Support darf eine eingeschraenkte Sub-Menge
    // (z. B. Trial-Extension <= 14 Tage) selbst ausloesen. Service-Code
    // erzwingt die Cap-Logik in der jeweiligen Custom-Method; die Matrix gibt
    // hier nur die Tuer auf (READ + CREATE — UPDATE-Operationen ueber Patch
    // sind Support nicht erlaubt, sonst koennte er auch ausserhalb der Cap
    // mutieren).
    {
      resource: AppResource.TENANT_SUBSCRIPTION_ACTIONS,
      action: [AppAction.READ, AppAction.CREATE],
    },
    // Vier-Augen-Antraege: Support sieht die Inbox, kann selbst keine
    // Requests stellen (CREATE) und nicht approven (MANAGE) — Eskalation
    // an ADMIN/OWNER.
    { resource: AppResource.PLATFORM_SUBSCRIPTION_CHANGE_REQUESTS, action: AppAction.READ },
    { resource: AppResource.TENANT_AUDIT_TRAIL, action: AppAction.READ },
    // OoS-Follow-up: Support liest VIES-Cache zur Diagnose, kein Export/Transfer.
    { resource: AppResource.VAT_VALIDATION_CACHE, action: AppAction.READ },
    { resource: AppResource.GDPR_SELF_EXPORT, action: AppAction.CREATE },
    // OoS-Item-7: Support darf Tenant-Logo lesen (Diagnose), nicht schreiben.
    { resource: AppResource.TENANT_BRANDING_ASSET, action: AppAction.READ },
    // CREATE: Impersonation starten. DELETE: eigene Sitzung beenden ("Zurück zur Plattform")
    // — ohne DELETE bleibt der Support-Mitarbeiter im Tenant-Kontext gefangen.
    { resource: AppResource.PLATFORM_IMPERSONATION, action: [AppAction.CREATE, AppAction.DELETE] },
    { resource: AppResource.PLATFORM_IMPERSONATION_EVENTS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_SYSTEM_HEALTH, action: AppAction.READ },
    // Support hat keinen READ auf platform-business-metrics — Globalblick bleibt Owner/Admin.
    { resource: AppResource.PLATFORM_TENANT_HEALTH, action: AppAction.READ },
    // Support liest Alerts und kann sie quittieren (acknowledge), aber nicht loeschen.
    { resource: AppResource.PLATFORM_ALERTS, action: [AppAction.READ, AppAction.UPDATE] },
    // Support sieht Konfig nur lesend; Schwellenwerte aendert ausschliesslich Owner.
    { resource: AppResource.PLATFORM_CONFIG, action: AppAction.READ },
    // Eigene Push-Subscription verwalten (Browser-Notifications fuer Critical-Alerts).
    { resource: AppResource.PLATFORM_PUSH_SUBSCRIPTION, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_CLOUD_CONNECTIONS, action: AppAction.READ },
    { resource: AppResource.TENANT_GRANTS, action: AppAction.READ },
    // Support liest Accounts (Login-Diagnose), aendert sie aber nicht.
    { resource: AppResource.ACCOUNTS, action: AppAction.READ },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Globaler Lieferanten-Katalog (Phase 2): Support liest mit, kein Schreibzugriff.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.READ },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: AppAction.READ },
    // Storefront-Publish: Support sieht Publish-Status fuer Ticket-Diagnose (kein CREATE).
    { resource: AppResource.STOREFRONT_PUBLISH, action: AppAction.READ },
    // Phase 6 — Brand- und Reservierungs-Schicht. Support liest mit (Ticket-
    // Diagnose), kein Schreibzugriff.
    { resource: AppResource.BRANDS, action: AppAction.READ },
    { resource: AppResource.RESERVATIONS, action: AppAction.READ },
  ],

  // =======================================================
  // TENANTS PERMISSIONS
  // =======================================================
  [UserSystemRole.TENANT_OWNER]: [
    // Persistente Belege (§146a AO, ADR beleg-bon-system): lesen + Status/Retention patchen.
    { resource: AppResource.RECEIPTS, action: [AppAction.READ, AppAction.UPDATE] },
    // Strukturierter Fiskal-Export der Belege (Phase 5).
    { resource: AppResource.RECEIPTS_EXPORT, action: AppAction.READ },
    // Beleg per E-Mail versenden (Phase 4, DSGVO-gated).
    { resource: AppResource.RECEIPTS_EMAIL, action: AppAction.CREATE },
    { resource: AppResource.USERS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCTS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.MANAGE },
    { resource: AppResource.ORDERS, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.DISCOUNTS, action: AppAction.MANAGE },
    { resource: AppResource.DISCOUNT_CODES, action: AppAction.MANAGE },
    { resource: AppResource.DISCOUNT_CODE_REDEMPTIONS, action: [AppAction.CREATE, AppAction.READ] },
    { resource: AppResource.WORKING_TIMES, action: AppAction.MANAGE },
    { resource: AppResource.PRE_ORDERS, action: AppAction.MANAGE },
    { resource: AppResource.PRINT_SERVER, action: AppAction.MANAGE },
    { resource: AppResource.PRINTER_COMMANDS, action: AppAction.MANAGE },
    { resource: AppResource.APIKEYS, action: AppAction.MANAGE },
    { resource: AppResource.LOG_EXPORT, action: AppAction.READ },
    { resource: AppResource.CLOUD_CONNECTION, action: AppAction.MANAGE },
    { resource: AppResource.OPENING_HOUR_EXCEPTIONS, action: AppAction.MANAGE },
    { resource: AppResource.CLOUD_EDGES, action: AppAction.MANAGE },
    { resource: AppResource.EDGE_PAIRING_CODES, action: AppAction.MANAGE },
    { resource: AppResource.SYNC_CONFLICTS, action: AppAction.MANAGE },
    // Sync-Status-Operator-UI: Owner darf Outbox-Eintraege patchen
    // ("Erneut versuchen" setzt status=pending, attempts=0, nextAttemptAt=null)
    // und removen ("Verwerfen" loescht den Eintrag terminal).
    { resource: AppResource.SYNC_OUTBOX, action: AppAction.MANAGE },
    { resource: AppResource.SYNC_CURSOR, action: AppAction.READ },
    { resource: AppResource.SYNC_RUNS, action: AppAction.READ },
    // Cloud-getriggerter Sofort-Sync (Click-to-Sync aus dem Cloud-Admin):
    // Owner stoesst einen Sofort-Cycle auf einem bestimmten Edge an.
    { resource: AppResource.SYNC_TRIGGERS, action: AppAction.CREATE },
    { resource: AppResource.BOOTSTRAP_REPORTS, action: AppAction.READ },
    // Cloud-spezifische Ressourcen
    { resource: AppResource.CORPORATE_CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES, action: AppAction.MANAGE },
    { resource: AppResource.INGREDIENTS, action: AppAction.MANAGE },
    { resource: AppResource.SUPPLIERS, action: AppAction.MANAGE },
    { resource: AppResource.SUPPLIER_PRODUCTS, action: AppAction.MANAGE },
    // Globaler Lieferanten-Katalog: lesen + Vorschlaege einreichen.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.READ },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.GTIN_LOOKUP_CACHE, action: AppAction.MANAGE },
    { resource: AppResource.EXTERNAL_OFF_LOOKUP, action: AppAction.READ },
    { resource: AppResource.INGREDIENTS_IMPORT, action: AppAction.MANAGE },
    // Katalog-Export/Import: Produktgruppen, Zutaten und Rezepte koennen als
    // JSON/XLSX exportiert und via JSON re-importiert werden (externalId-Match
    // → Update, sonst Neu anlegen). Inkrement 2 (Rezepte+Zutaten) ergaenzt
    // Tiefe-Modus fuer transitive Dependencies.
    { resource: AppResource.PRODUCT_GROUPS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCT_GROUPS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.INGREDIENTS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCTS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCTS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORIES, action: AppAction.MANAGE },
    { resource: AppResource.INCOMING_GOODS, action: AppAction.MANAGE },
    { resource: AppResource.WRITE_OFFS, action: AppAction.MANAGE },
    { resource: AppResource.OUTGOING_GOODS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORY_MOVEMENTS, action: AppAction.MANAGE },
    { resource: AppResource.STOCK_LEVELS, action: AppAction.READ },
    { resource: AppResource.INVOICES, action: AppAction.MANAGE },
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.MANAGE },
    // Tagesabschluss: Owner darf voll MANAGE (start, cancel, reAggregate, audit).
    { resource: AppResource.BUSINESS_DAY_REPORTS, action: AppAction.MANAGE },
    { resource: AppResource.BUSINESS_DAY_REPORT_EVENTS, action: AppAction.READ },
    { resource: AppResource.CASH_SESSIONS, action: AppAction.MANAGE },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.DEVICES, action: AppAction.MANAGE },
    // Live-Verbindungszählung der Geräte (Socket-Registry) — read-only.
    { resource: AppResource.DEVICE_CONNECTIONS, action: AppAction.READ },
    { resource: AppResource.SHIFTS, action: AppAction.MANAGE },
    { resource: AppResource.SHIFT_TEMPLATES, action: AppAction.MANAGE },
    { resource: AppResource.SHIFT_SWAP_REQUESTS, action: AppAction.MANAGE },
    { resource: AppResource.OPEN_SHIFT_APPLICATIONS, action: AppAction.MANAGE },
    { resource: AppResource.LEAVE_REQUESTS, action: AppAction.MANAGE },
    { resource: AppResource.HOLIDAY_CALENDARS, action: AppAction.MANAGE },
    { resource: AppResource.WORKING_TIME_REPORTS, action: AppAction.CREATE },
    { resource: AppResource.LOCATIONS, action: AppAction.MANAGE },
    { resource: AppResource.ORDER_INTERACTIONS, action: AppAction.MANAGE },
    { resource: AppResource.ORGANIZATIONS, action: AppAction.READ },
    { resource: AppResource.FRAUD_ANALYTICS, action: AppAction.READ },
    { resource: AppResource.FRAUD_ALERT_RULES, action: AppAction.MANAGE },
    { resource: AppResource.FRAUD_ALERTS, action: [AppAction.READ, AppAction.UPDATE] },
    // Tenant-First-Class (Phase 1+ Migration): TENANT_OWNER darf eigene
    // Tenant-Stamm-Daten lesen und patchen. Feld-Level-Whitelist im
    // `tenantsRestrictTenantPatchHook` beschraenkt die mutierbaren Felder auf
    // name/branding/localization/legalEntity/incidentContact und ausgewaehlte
    // billing.address-Pfade — Subscription/Stripe/TSE-Secrets bleiben
    // PLATFORM_*-only.
    { resource: AppResource.TENANTS, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.SUBSCRIPTION_PLANS, action: AppAction.READ },
    // Abo-Rechnungen: Tenant-Owner darf die eigenen Subscription-Rechnungen lesen
    // (Download/Beleg-Archiv). Multi-Tenancy-Hook scoped auf den eigenen Tenant.
    { resource: AppResource.PLATFORM_SUBSCRIPTION_INVOICES, action: AppAction.READ },
    // Subscription-Self-Service (Schicht 1 der Drei-Schicht-Sicherung):
    // Plan-Wechsel zwischen Self-Service-Tiers, Bezahlmethode via PSP-Hosted-
    // Checkout, Kuendigung zum Periodenende. Custom-Method-Service mit
    // method-spezifischen Validatoren; Coupon/Limit-Override/Enterprise bleiben
    // PLATFORM_*-only via separater Resources.
    {
      resource: AppResource.TENANT_SUBSCRIPTION_ACTIONS,
      action: [AppAction.READ, AppAction.CREATE, AppAction.UPDATE],
    },
    { resource: AppResource.TENANT_AUDIT_TRAIL, action: AppAction.READ },
    // OoS-Follow-up: Owner darf DSGVO-Tenant-Export anstossen, Owner-Transfer
    // an einen MANAGER weitergeben, VIES-Cache lesen, Self-Export.
    { resource: AppResource.GDPR_TENANT_EXPORT, action: AppAction.CREATE },
    { resource: AppResource.GDPR_SELF_EXPORT, action: AppAction.CREATE },
    { resource: AppResource.TENANT_OWNER_TRANSFER, action: AppAction.CREATE },
    { resource: AppResource.VAT_VALIDATION_CACHE, action: AppAction.READ },
    // OoS-Item-7: Tenant-Logo-Upload (CREATE/REMOVE) und Read fuer Anzeige.
    { resource: AppResource.TENANT_BRANDING_ASSET, action: AppAction.MANAGE },
    // D-07 / STORE-04: Storefront-Bild-Assets. Owner darf hochladen, anzeigen
    // und entfernen (voller Schreibzugriff am oeffentlichen Auftritt).
    { resource: AppResource.STOREFRONT_ASSET, action: AppAction.MANAGE },
    // Storefront-Seiten + Konfiguration: Owner hat vollen Zugriff am oeffentlichen Auftritt.
    { resource: AppResource.STOREFRONT_PAGES, action: AppAction.MANAGE },
    { resource: AppResource.STOREFRONT_CONFIG, action: AppAction.MANAGE },
    // Plattform-Theme-Katalog ist global + plattform-kuratiert → Tenant nur READ
    // (Theme-Auswahl auf der Storefront-Landing).
    { resource: AppResource.STOREFRONT_THEME_CATALOG, action: AppAction.READ },
    // Storefront-Publish: Owner darf manuell publizieren (Publish-Button, UI kommt Phase 3)
    // und den Publish-Status abrufen. STAFF hat bewusst KEINEN Eintrag (→ 403).
    { resource: AppResource.STOREFRONT_PUBLISH, action: [AppAction.CREATE, AppAction.READ] },
    // Storefront-Preview-Token (Phase 4 PUBW-05, D-11..D-15): Owner darf signierte
    // Preview-Links fuer den Draft-Render erzeugen (HMAC-Token, TTL 1h). STAFF hat
    // bewusst KEINEN Eintrag (Staff erzeugen keine Preview-Links).
    { resource: AppResource.STOREFRONT_PREVIEW_TOKEN, action: AppAction.CREATE },
    // Tenant-Settings: TENANT_OWNER darf eigene Settings READ + CREATE + UPDATE.
    // CREATE ist noetig, weil neue Tenants vor dem ersten Toggle kein Settings-
    // Dokument haben — beim Aktivieren via UI legt das Frontend einen Datensatz
    // an. Field-Allowlist im `restrictTenantPatch`-Hook (tenant-settings.ts)
    // beschraenkt die mutierbaren Felder auf `aiExtraction.enabled`,
    // `aiExtraction.autoMatchThreshold` und `aiExtraction.consentedAt` —
    // Kosten-/Quotenfelder bleiben PLATFORM_OWNER-only.
    {
      resource: AppResource.TENANT_SETTINGS,
      action: [AppAction.READ, AppAction.CREATE, AppAction.UPDATE],
    },
    // KI-Wareneingang: Foto hochladen + Audit lesen.
    { resource: AppResource.INCOMING_GOODS_EXTRACT, action: AppAction.CREATE },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.SYNC_REJECTS, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT_DAILY, action: AppAction.READ },
    // KI-Speisekarten-Scan: hochladen, anwenden (Bulk-Create), Audit lesen.
    { resource: AppResource.MENU_EXTRACT, action: AppAction.CREATE },
    { resource: AppResource.MENU_IMPORT, action: AppAction.CREATE },
    { resource: AppResource.MENU_EXTRACT_AUDIT, action: AppAction.READ },
    // Onboarding-Fortschritt: lesen + fortschreiben.
    { resource: AppResource.ONBOARDING_STATE, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.TENANT_GRANTS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Dienstleister/Mitarbeiter per E-Mail in den eigenen Tenant einladen.
    { resource: AppResource.ACCOUNT_INVITATIONS, action: AppAction.MANAGE },
    // Tenant-Audit-Trail (append-only)
    { resource: AppResource.AUDIT_EVENTS, action: AppAction.READ },
    // Audit-Redactions (Phase 2 — DSGVO-Loeschungen / Fehleintraege markieren)
    { resource: AppResource.AUDIT_EVENT_REDACTIONS, action: [AppAction.READ, AppAction.CREATE] },
    // Benachrichtigungen: eigene In-App-Records lesen / als gelesen
    // markieren / loeschen. CREATE entfaellt — Notifications werden vom
    // Backend-Sender erzeugt (interner Aufruf bypasst authorize()).
    { resource: AppResource.NOTIFICATIONS, action: [AppAction.READ, AppAction.UPDATE, AppAction.DELETE] },
    { resource: AppResource.NOTIFICATION_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.PUSH_SUBSCRIPTIONS, action: AppAction.MANAGE },
    // Phase 6 — Brand- und Reservierungs-Schicht: Owner pflegt Marken,
    // Reservierungen, Tische und Slots vollumfaenglich.
    { resource: AppResource.BRANDS, action: AppAction.MANAGE },
    { resource: AppResource.RESERVATIONS, action: AppAction.MANAGE },
    { resource: AppResource.RESERVATION_TABLES, action: AppAction.MANAGE },
    { resource: AppResource.RESERVABLE_SLOTS, action: AppAction.MANAGE },
    AppAbility.CAN_SEE_REPORTS,
    AppAbility.CAN_REFUND,
    AppAbility.CAN_VOID_ORDER,
  ],

  // Techniker — Admin-ähnliche Rechte für Systemkonfiguration und Support
  [UserSystemRole.TENANT_TECHNICIAN]: [
    // Persistente Belege (§146a AO): lesen + Status/Retention patchen.
    { resource: AppResource.RECEIPTS, action: [AppAction.READ, AppAction.UPDATE] },
    // Strukturierter Fiskal-Export der Belege (Phase 5).
    { resource: AppResource.RECEIPTS_EXPORT, action: AppAction.READ },
    // Beleg per E-Mail versenden (Phase 4, DSGVO-gated).
    { resource: AppResource.RECEIPTS_EMAIL, action: AppAction.CREATE },
    { resource: AppResource.USERS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCTS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.MANAGE },
    { resource: AppResource.ORDERS, action: AppAction.MANAGE },
    { resource: AppResource.DISCOUNTS, action: AppAction.MANAGE },
    { resource: AppResource.DISCOUNT_CODES, action: AppAction.MANAGE },
    { resource: AppResource.DISCOUNT_CODE_REDEMPTIONS, action: [AppAction.CREATE, AppAction.READ] },
    { resource: AppResource.WORKING_TIMES, action: AppAction.MANAGE },
    { resource: AppResource.PRE_ORDERS, action: AppAction.MANAGE },
    { resource: AppResource.PRINT_SERVER, action: AppAction.MANAGE },
    { resource: AppResource.PRINTER_COMMANDS, action: AppAction.MANAGE },
    { resource: AppResource.APIKEYS, action: AppAction.MANAGE },
    { resource: AppResource.CLOUD_CONNECTION, action: AppAction.MANAGE },
    { resource: AppResource.OPENING_HOUR_EXCEPTIONS, action: AppAction.MANAGE },
    { resource: AppResource.CLOUD_EDGES, action: AppAction.MANAGE },
    { resource: AppResource.EDGE_PAIRING_CODES, action: AppAction.MANAGE },
    { resource: AppResource.SYNC_CONFLICTS, action: AppAction.MANAGE },
    { resource: AppResource.SYNC_OUTBOX, action: AppAction.MANAGE },
    { resource: AppResource.SYNC_CURSOR, action: AppAction.READ },
    { resource: AppResource.SYNC_RUNS, action: AppAction.READ },
    // Cloud-getriggerter Sofort-Sync — Techniker (Admin-aequivalent) darf
    // einen Sofort-Cycle pro Edge anstossen (Support-Use-Case).
    { resource: AppResource.SYNC_TRIGGERS, action: AppAction.CREATE },
    { resource: AppResource.BOOTSTRAP_REPORTS, action: AppAction.READ },
    { resource: AppResource.LOCATIONS, action: AppAction.MANAGE },
    { resource: AppResource.SYSTEM, action: AppAction.MANAGE },
    // Cloud-spezifische Ressourcen
    { resource: AppResource.CORPORATE_CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES, action: AppAction.MANAGE },
    { resource: AppResource.INGREDIENTS, action: AppAction.MANAGE },
    { resource: AppResource.SUPPLIERS, action: AppAction.MANAGE },
    { resource: AppResource.SUPPLIER_PRODUCTS, action: AppAction.MANAGE },
    // Globaler Lieferanten-Katalog: lesen + Vorschlaege einreichen.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.READ },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.GTIN_LOOKUP_CACHE, action: AppAction.MANAGE },
    { resource: AppResource.EXTERNAL_OFF_LOOKUP, action: AppAction.READ },
    { resource: AppResource.INGREDIENTS_IMPORT, action: AppAction.MANAGE },
    // Katalog-Export/Import (siehe TENANT_OWNER).
    { resource: AppResource.PRODUCT_GROUPS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCT_GROUPS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.INGREDIENTS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCTS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCTS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORIES, action: AppAction.MANAGE },
    { resource: AppResource.INCOMING_GOODS, action: AppAction.MANAGE },
    { resource: AppResource.WRITE_OFFS, action: AppAction.MANAGE },
    { resource: AppResource.OUTGOING_GOODS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORY_MOVEMENTS, action: AppAction.MANAGE },
    { resource: AppResource.STOCK_LEVELS, action: AppAction.READ },
    { resource: AppResource.INVOICES, action: AppAction.MANAGE },
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.MANAGE },
    // Tagesabschluss: Techniker erstellt/wiederholt Reports zur Diagnose, kann
    // Audit-Freigabe geben.
    { resource: AppResource.BUSINESS_DAY_REPORTS, action: AppAction.MANAGE },
    { resource: AppResource.BUSINESS_DAY_REPORT_EVENTS, action: AppAction.READ },
    { resource: AppResource.CASH_SESSIONS, action: AppAction.MANAGE },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.DEVICES, action: AppAction.MANAGE },
    // Live-Verbindungszählung der Geräte (Socket-Registry) — read-only.
    { resource: AppResource.DEVICE_CONNECTIONS, action: AppAction.READ },
    { resource: AppResource.SHIFTS, action: AppAction.MANAGE },
    { resource: AppResource.SHIFT_TEMPLATES, action: AppAction.MANAGE },
    { resource: AppResource.SHIFT_SWAP_REQUESTS, action: AppAction.MANAGE },
    { resource: AppResource.OPEN_SHIFT_APPLICATIONS, action: AppAction.MANAGE },
    { resource: AppResource.LEAVE_REQUESTS, action: AppAction.MANAGE },
    { resource: AppResource.HOLIDAY_CALENDARS, action: AppAction.MANAGE },
    { resource: AppResource.WORKING_TIME_REPORTS, action: AppAction.CREATE },
    { resource: AppResource.ORDER_INTERACTIONS, action: AppAction.MANAGE },
    { resource: AppResource.FRAUD_ANALYTICS, action: AppAction.READ },
    { resource: AppResource.FRAUD_ALERT_RULES, action: AppAction.MANAGE },
    { resource: AppResource.FRAUD_ALERTS, action: [AppAction.READ, AppAction.UPDATE] },
    // Tenant-First-Class: Techniker liest Tenant-Stamm-Daten, aber editiert
    // nicht (Owner-Privileg).
    { resource: AppResource.TENANTS, action: AppAction.READ },
    { resource: AppResource.SUBSCRIPTION_PLANS, action: AppAction.READ },
    { resource: AppResource.TENANT_AUDIT_TRAIL, action: AppAction.READ },
    // OoS-Follow-up: Techniker darf eigenen DSGVO-Self-Export anstossen und
    // VIES-Cache zur Diagnose lesen — kein Tenant-Export, kein Owner-Transfer.
    { resource: AppResource.GDPR_SELF_EXPORT, action: AppAction.CREATE },
    { resource: AppResource.VAT_VALIDATION_CACHE, action: AppAction.READ },
    // OoS-Item-7: Logo lesen (UI-Anzeige + Beleg-Druck), kein Upload.
    { resource: AppResource.TENANT_BRANDING_ASSET, action: AppAction.READ },
    // Tenant-Settings + KI-Wareneingang: Techniker hat Manager-aequivalente Rechte.
    { resource: AppResource.TENANT_SETTINGS, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT, action: AppAction.CREATE },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.SYNC_REJECTS, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT_DAILY, action: AppAction.READ },
    // KI-Speisekarten-Scan: Techniker hat Manager-aequivalente Rechte.
    { resource: AppResource.MENU_EXTRACT, action: AppAction.CREATE },
    { resource: AppResource.MENU_IMPORT, action: AppAction.CREATE },
    { resource: AppResource.MENU_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.ONBOARDING_STATE, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Tenant-Audit-Trail (append-only)
    { resource: AppResource.AUDIT_EVENTS, action: AppAction.READ },
    // Audit-Redactions (Phase 2 — DSGVO-Loeschungen / Fehleintraege markieren)
    { resource: AppResource.AUDIT_EVENT_REDACTIONS, action: [AppAction.READ, AppAction.CREATE] },
    // Benachrichtigungen — wie TENANT_OWNER
    { resource: AppResource.NOTIFICATIONS, action: [AppAction.READ, AppAction.UPDATE, AppAction.DELETE] },
    { resource: AppResource.NOTIFICATION_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.PUSH_SUBSCRIPTIONS, action: AppAction.MANAGE },
    // Dienstleister/Mitarbeiter per E-Mail in den eigenen Tenant einladen.
    { resource: AppResource.ACCOUNT_INVITATIONS, action: AppAction.MANAGE },
    // Phase 6 — Brand- und Reservierungs-Schicht: Techniker hat Admin-
    // aequivalente Rechte fuer Diagnose/Support.
    { resource: AppResource.BRANDS, action: AppAction.MANAGE },
    { resource: AppResource.RESERVATIONS, action: AppAction.MANAGE },
    { resource: AppResource.RESERVATION_TABLES, action: AppAction.MANAGE },
    { resource: AppResource.RESERVABLE_SLOTS, action: AppAction.MANAGE },
    AppAbility.CAN_SEE_REPORTS,
    AppAbility.CAN_REFUND,
    AppAbility.CAN_VOID_ORDER,
    AppAbility.CAN_MANAGE_TIME,
    AppAbility.CAN_SEE_POS_PIN,
    AppAbility.CAN_READ_SENSITIVE_USER_DATA,
  ],

  [UserSystemRole.TENANT_MANAGER]: [
    // Self-Service: Manager darf seinen EIGENEN User-Datensatz patchen
    // (posPin, password, email). Self-Restriction wird im Service-Hook
    // `restrictUserSelfPatch` enforced — kein Patch fremder User, keine
    // Eskalation auf role/tenantId/permissions.
    { resource: AppResource.USERS, action: [AppAction.READ, AppAction.UPDATE] },
    // Persistente Belege (§146a AO): lesen.
    { resource: AppResource.RECEIPTS, action: AppAction.READ },
    // Beleg per E-Mail versenden (Phase 4, DSGVO-gated).
    { resource: AppResource.RECEIPTS_EMAIL, action: AppAction.CREATE },
    { resource: AppResource.PRODUCTS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: [AppAction.CREATE, AppAction.READ, AppAction.UPDATE, AppAction.DELETE] },
    { resource: AppResource.DISCOUNTS, action: AppAction.MANAGE },
    { resource: AppResource.DISCOUNT_CODES, action: AppAction.MANAGE },
    { resource: AppResource.DISCOUNT_CODE_REDEMPTIONS, action: [AppAction.CREATE, AppAction.READ] },
    { resource: AppResource.WORKING_TIMES, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.PRE_ORDERS, action: AppAction.MANAGE },
    { resource: AppResource.PRINT_SERVER, action: [AppAction.READ, AppAction.UPDATE] },
    // Manager darf Test-Drucke aus der Cloud anstoßen (CREATE + READ für Status-Polling).
    { resource: AppResource.PRINTER_COMMANDS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.APIKEYS, action: AppAction.READ },
    { resource: AppResource.LOG_EXPORT, action: AppAction.READ },
    { resource: AppResource.CLOUD_EDGES, action: AppAction.READ },
    { resource: AppResource.EDGE_PAIRING_CODES, action: AppAction.READ },
    // Sync-Status-Operator-UI: Manager darf Konflikte aufloesen und
    // Outbox-Eintraege erneut versuchen / verwerfen (gleicher Workflow wie
    // Owner, weil das laufende Geschaeft nicht warten kann).
    { resource: AppResource.SYNC_CONFLICTS, action: AppAction.MANAGE },
    { resource: AppResource.SYNC_OUTBOX, action: AppAction.MANAGE },
    // Cloud-spezifische Ressourcen
    { resource: AppResource.CORPORATE_CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES, action: AppAction.READ },
    { resource: AppResource.INGREDIENTS, action: AppAction.READ },
    { resource: AppResource.SUPPLIERS, action: AppAction.MANAGE },
    { resource: AppResource.SUPPLIER_PRODUCTS, action: AppAction.MANAGE },
    // Globaler Lieferanten-Katalog: lesen + Vorschlaege einreichen.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.READ },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.GTIN_LOOKUP_CACHE, action: AppAction.MANAGE },
    { resource: AppResource.EXTERNAL_OFF_LOOKUP, action: AppAction.READ },
    { resource: AppResource.INGREDIENTS_IMPORT, action: AppAction.MANAGE },
    // Katalog-Export/Import (siehe TENANT_OWNER).
    { resource: AppResource.PRODUCT_GROUPS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCT_GROUPS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.INGREDIENTS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCTS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCTS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS_EXPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORIES, action: AppAction.MANAGE },
    { resource: AppResource.INCOMING_GOODS, action: AppAction.MANAGE },
    { resource: AppResource.WRITE_OFFS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORY_MOVEMENTS, action: AppAction.READ },
    { resource: AppResource.STOCK_LEVELS, action: AppAction.READ },
    { resource: AppResource.INVOICES, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.MANAGE },
    // Tagesabschluss: Manager darf täglich auslösen + lesen, kann aber den
    // finalen Audit-Stempel nicht setzen (Owner-Privileg). MANAGE deckt
    // Custom-Methods startClosing/reAggregate; Status-Übergang nach
    // 'audited' wird im Service-Hook auf Owner+Technician beschränkt.
    { resource: AppResource.BUSINESS_DAY_REPORTS, action: AppAction.MANAGE },
    { resource: AppResource.BUSINESS_DAY_REPORT_EVENTS, action: AppAction.READ },
    { resource: AppResource.CASH_SESSIONS, action: AppAction.MANAGE },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.SHIFTS, action: AppAction.MANAGE },
    { resource: AppResource.SHIFT_TEMPLATES, action: AppAction.MANAGE },
    { resource: AppResource.SHIFT_SWAP_REQUESTS, action: AppAction.MANAGE },
    { resource: AppResource.OPEN_SHIFT_APPLICATIONS, action: AppAction.MANAGE },
    { resource: AppResource.LEAVE_REQUESTS, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.HOLIDAY_CALENDARS, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.WORKING_TIME_REPORTS, action: AppAction.CREATE },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },
    { resource: AppResource.ORDER_INTERACTIONS, action: AppAction.MANAGE },
    { resource: AppResource.FRAUD_ANALYTICS, action: AppAction.READ },
    { resource: AppResource.FRAUD_ALERT_RULES, action: AppAction.READ },
    { resource: AppResource.FRAUD_ALERTS, action: [AppAction.READ, AppAction.UPDATE] },
    // Tenant-First-Class: Manager liest Tenant-Stamm-Daten + Audit-Trail.
    { resource: AppResource.TENANTS, action: AppAction.READ },
    { resource: AppResource.SUBSCRIPTION_PLANS, action: AppAction.READ },
    { resource: AppResource.TENANT_AUDIT_TRAIL, action: AppAction.READ },
    // OoS-Follow-up: Manager darf eigenen DSGVO-Self-Export anstossen und
    // VIES-Cache lesen (z.B. fuer Lieferanten-USt-IdNr-Diagnose). Tenant-
    // weiter Export bleibt OWNER vorbehalten.
    { resource: AppResource.GDPR_SELF_EXPORT, action: AppAction.CREATE },
    { resource: AppResource.VAT_VALIDATION_CACHE, action: AppAction.READ },
    // OoS-Item-7: Logo lesen (UI-Anzeige + Beleg-Druck), kein Upload.
    { resource: AppResource.TENANT_BRANDING_ASSET, action: AppAction.READ },
    // D-07 / STORE-04: Storefront-Bild-Assets. Manager darf — wie Owner —
    // hochladen, anzeigen und entfernen (operative Pflege des Auftritts).
    {
      resource: AppResource.STOREFRONT_ASSET,
      action: [AppAction.CREATE, AppAction.READ, AppAction.DELETE],
    },
    // Storefront-Seiten: Manager pflegt den Auftritt (anlegen/bearbeiten/loeschen).
    {
      resource: AppResource.STOREFRONT_PAGES,
      action: [AppAction.CREATE, AppAction.READ, AppAction.UPDATE, AppAction.DELETE],
    },
    // Storefront-Konfiguration: Manager liest + aktualisiert (Seed via Owner/System).
    { resource: AppResource.STOREFRONT_CONFIG, action: [AppAction.READ, AppAction.UPDATE] },
    // Plattform-Theme-Katalog: nur lesend (global, plattform-kuratiert).
    { resource: AppResource.STOREFRONT_THEME_CATALOG, action: AppAction.READ },
    // Storefront-Publish: Manager darf — wie Owner — manuell publizieren und Status abrufen.
    // TENANT_STAFF hat bewusst KEINEN Eintrag (→ 403 beim Publish-Versuch).
    { resource: AppResource.STOREFRONT_PUBLISH, action: [AppAction.CREATE, AppAction.READ] },
    // Storefront-Preview-Token (Phase 4 PUBW-05): Manager darf — wie Owner — signierte
    // Preview-Links fuer den Draft-Render erzeugen. STAFF hat bewusst KEINEN Eintrag.
    { resource: AppResource.STOREFRONT_PREVIEW_TOKEN, action: AppAction.CREATE },
    // Tenant-Settings: nur lesend; Aktivierung bleibt PLATFORM_OWNER vorbehalten.
    { resource: AppResource.TENANT_SETTINGS, action: AppAction.READ },
    // KI-Wareneingang: Foto hochladen + Audit lesen.
    { resource: AppResource.INCOMING_GOODS_EXTRACT, action: AppAction.CREATE },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.SYNC_REJECTS, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT_DAILY, action: AppAction.READ },
    // KI-Speisekarten-Scan: hochladen, anwenden (Bulk-Create), Audit lesen.
    { resource: AppResource.MENU_EXTRACT, action: AppAction.CREATE },
    { resource: AppResource.MENU_IMPORT, action: AppAction.CREATE },
    { resource: AppResource.MENU_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.ONBOARDING_STATE, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Tenant-Audit-Trail (append-only)
    { resource: AppResource.AUDIT_EVENTS, action: AppAction.READ },
    // Manager darf Redactions sehen, aber NICHT selbst durchfuehren — nur
    // OWNER/TECHNICIAN haben CREATE. Daher hier nur READ.
    { resource: AppResource.AUDIT_EVENT_REDACTIONS, action: AppAction.READ },
    // Benachrichtigungen — wie TENANT_OWNER
    { resource: AppResource.NOTIFICATIONS, action: [AppAction.READ, AppAction.UPDATE, AppAction.DELETE] },
    { resource: AppResource.NOTIFICATION_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.PUSH_SUBSCRIPTIONS, action: AppAction.MANAGE },
    // Phase 6 — Brand- und Reservierungs-Schicht: Manager pflegt Marken,
    // Reservierungen, Tische und Slots gleichberechtigt zum Owner.
    { resource: AppResource.BRANDS, action: AppAction.MANAGE },
    { resource: AppResource.RESERVATIONS, action: AppAction.MANAGE },
    { resource: AppResource.RESERVATION_TABLES, action: AppAction.MANAGE },
    { resource: AppResource.RESERVABLE_SLOTS, action: AppAction.MANAGE },
    AppAbility.CAN_VOID_ORDER,
  ],

  [UserSystemRole.TENANT_STAFF]: [
    // Self-Service: Mitarbeiter darf seinen EIGENEN User-Datensatz patchen
    // (posPin, password, email). Self-Restriction wird im Service-Hook
    // `restrictUserSelfPatch` enforced — kein Patch fremder User, keine
    // Eskalation auf role/tenantId/permissions.
    { resource: AppResource.USERS, action: [AppAction.READ, AppAction.UPDATE] },
    // Persistente Belege (§146a AO): lesen.
    { resource: AppResource.RECEIPTS, action: AppAction.READ },
    // Beleg per E-Mail versenden (Phase 4, DSGVO-gated).
    { resource: AppResource.RECEIPTS_EMAIL, action: AppAction.CREATE },
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: [AppAction.CREATE, AppAction.READ] },
    { resource: AppResource.DISCOUNTS, action: AppAction.READ },
    { resource: AppResource.WORKING_TIMES, action: AppAction.READ },
    { resource: AppResource.PRE_ORDERS, action: [AppAction.CREATE, AppAction.READ, AppAction.UPDATE] },
    // Cloud-spezifische Ressourcen (Lese-/Erfassungs-Rechte)
    { resource: AppResource.CUSTOMERS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.PRICELISTS, action: AppAction.READ },
    { resource: AppResource.RECIPES, action: AppAction.READ },
    { resource: AppResource.INGREDIENTS, action: AppAction.READ },
    { resource: AppResource.SUPPLIERS, action: AppAction.READ },
    { resource: AppResource.SUPPLIER_PRODUCTS, action: AppAction.READ },
    { resource: AppResource.STOCK_LEVELS, action: AppAction.READ },
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.READ },
    // Tagesabschluss: Staff darf nur lesen (z.B. eigene Tageskennzahlen sehen).
    // CREATE/UPDATE bleibt MANAGER+.
    { resource: AppResource.BUSINESS_DAY_REPORTS, action: AppAction.READ },
    { resource: AppResource.BUSINESS_DAY_REPORT_EVENTS, action: AppAction.READ },
    // Kassen-Sessions: Staff darf eigene Schubladen öffnen/zählen/schließen.
    { resource: AppResource.CASH_SESSIONS, action: [AppAction.READ, AppAction.CREATE, AppAction.UPDATE] },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE }, // eigene Prefs
    { resource: AppResource.SHIFTS, action: AppAction.READ },
    { resource: AppResource.SHIFT_TEMPLATES, action: AppAction.READ },
    // STAFF: READ alle Swaps, CREATE eigene, UPDATE für Übernahme/Cancel.
    // Backend-Hook restrictSwapPatchForStaff erzwingt Self-Scope serverseitig.
    { resource: AppResource.SHIFT_SWAP_REQUESTS, action: [AppAction.READ, AppAction.CREATE, AppAction.UPDATE] },
    // STAFF: READ eigene Bewerbungen + CREATE neue + UPDATE für Self-Cancel.
    { resource: AppResource.OPEN_SHIFT_APPLICATIONS, action: [AppAction.READ, AppAction.CREATE, AppAction.UPDATE] },
    // STAFF: UPDATE wird benötigt, damit der eigene PENDING-Antrag in CANCELLED
    // überführt werden kann. Service-Hook `restrictPatchToManager` schränkt das
    // serverseitig auf die eigene Cancellation ein.
    { resource: AppResource.LEAVE_REQUESTS, action: [AppAction.READ, AppAction.CREATE, AppAction.UPDATE] },
    // STAFF darf lesen, welche Tage Feiertage sind — fuer eigene Urlaubsantraege
    // und die Personalzeit-Sicht. Editieren bleibt MANAGER/OWNER.
    { resource: AppResource.HOLIDAY_CALENDARS, action: AppAction.READ },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },
    { resource: AppResource.ORDER_INTERACTIONS, action: [AppAction.READ, AppAction.CREATE] },
    // Tenant-First-Class: Staff liest Tenant-Stamm-Daten + Plan-Katalog (UI-
    // Anzeige Plan-Tier). Audit-Trail bleibt MANAGER+ vorbehalten.
    { resource: AppResource.TENANTS, action: AppAction.READ },
    { resource: AppResource.SUBSCRIPTION_PLANS, action: AppAction.READ },
    // OoS-Follow-up: DSGVO-Art-15-Selbstauskunft fuer eigene Personendaten.
    { resource: AppResource.GDPR_SELF_EXPORT, action: AppAction.CREATE },
    // OoS-Item-7: Logo lesen — fuer POS-/Tablet-Belege.
    { resource: AppResource.TENANT_BRANDING_ASSET, action: AppAction.READ },
    // D-07 / STORE-04: Storefront-Bild-Assets. Staff darf NUR lesen — die
    // Bilder im Bild-Picker sehen, aber NICHT hochladen/loeschen. Schreib-
    // rechte am oeffentlichen Auftritt bleiben Owner/Manager vorbehalten.
    // (Ohne dieses READ liefert der Picker-Anzeigepfad 403 fuer Staff.)
    { resource: AppResource.STOREFRONT_ASSET, action: AppAction.READ },
    // Storefront-Seiten + Konfiguration: Staff darf ansehen, aber nicht bearbeiten
    // (Schreibrechte am oeffentlichen Auftritt bleiben Owner/Manager vorbehalten).
    { resource: AppResource.STOREFRONT_PAGES, action: AppAction.READ },
    { resource: AppResource.STOREFRONT_CONFIG, action: AppAction.READ },
    // Plattform-Theme-Katalog: nur lesend (Theme-Auswahl-Anzeige).
    { resource: AppResource.STOREFRONT_THEME_CATALOG, action: AppAction.READ },
    // Tenant-Settings: lesen (z.B. um zu wissen, ob KI-Funktion aktiviert ist).
    { resource: AppResource.TENANT_SETTINGS, action: AppAction.READ },
    // KI-Wareneingang: Mitarbeitende duerfen Foto hochladen.
    { resource: AppResource.INCOMING_GOODS_EXTRACT, action: AppAction.CREATE },
    // Onboarding-Fortschritt: nur lesen (Dashboard-Widget), kein Fortschreiben.
    { resource: AppResource.ONBOARDING_STATE, action: AppAction.READ },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Benachrichtigungen — wie alle Tenant-Rollen: eigene In-App-Records
    // lesen / als gelesen markieren / loeschen. CREATE entfaellt — der
    // Sender bypasst authorize() per provider=undefined.
    { resource: AppResource.NOTIFICATIONS, action: [AppAction.READ, AppAction.UPDATE, AppAction.DELETE] },
    { resource: AppResource.NOTIFICATION_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.PUSH_SUBSCRIPTIONS, action: AppAction.MANAGE },
    // Phase 6 — Brand- und Reservierungs-Schicht: Staff darf Marken/Tische/
    // Slots ansehen (Anzeige im Admin/Tisch-Plan), aber NICHT bearbeiten.
    { resource: AppResource.BRANDS, action: AppAction.READ },
    { resource: AppResource.RESERVATION_TABLES, action: AppAction.READ },
    { resource: AppResource.RESERVABLE_SLOTS, action: AppAction.READ },
    // Reservierungen: Staff sieht den Reservierungs-Bestand und darf Status
    // setzen (ARRIVED/NO_SHOW/CANCELLED) — KEIN CREATE/DELETE.
    { resource: AppResource.RESERVATIONS, action: [AppAction.READ, AppAction.UPDATE] },
  ],

  // =======================================================
  // DEVICE PERMISSIONS
  // =======================================================

  // 1. POS COUNTER (Stationäre Kasse)
  // Alt: USERS_READ_POS, ORDERS_FULL, PRODUCTS_READ, LOCATIONS_READ, USERS_TIME_CLOCK
  [UserSystemRole.DEVICE_POS]: [
    // Darf Kellner-Logins abrufen (USERS_READ_POS)
    { resource: AppResource.USERS, action: AppAction.READ },

    // Volle Kontrolle über Bestellungen (ORDERS_FULL)
    { resource: AppResource.ORDERS, action: AppAction.MANAGE },

    // Persistente Belege (§146a AO): am POS lesen/nachdrucken.
    { resource: AppResource.RECEIPTS, action: AppAction.READ },
    // Beleg per E-Mail an den Gast versenden (Phase 4, DSGVO-gated).
    { resource: AppResource.RECEIPTS_EMAIL, action: AppAction.CREATE },

    // Produkte & Menüs lesen (PRODUCTS_READ)
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    // Rabatte lesen, um sie am POS auswählen/anwenden zu können (Anwendung
    // selbst läuft über Order-Write + CAN_DISCOUNT-Ability).
    { resource: AppResource.DISCOUNTS, action: AppAction.READ },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },

    // Order-Interactions (Bestellverlauf)
    { resource: AppResource.ORDER_INTERACTIONS, action: AppAction.MANAGE },

    // Kunden lesen/anlegen (für Loyalty)
    { resource: AppResource.CUSTOMERS, action: [AppAction.READ, AppAction.CREATE, AppAction.UPDATE] },

    // Firmenkunden lesen — zum Verknüpfen mit Bestellungen am POS. Anlegen/
    // Ändern bewusst nicht: Firmenkunden tragen Rechnungsdaten/Steuer-IDs und
    // werden im Cloud-Admin gepflegt.
    { resource: AppResource.CORPORATE_CUSTOMERS, action: AppAction.READ },

    // Vorbestellungen verwalten
    { resource: AppResource.PRE_ORDERS, action: [AppAction.CREATE, AppAction.READ, AppAction.UPDATE] },

    // Öffnungszeiten-Ausnahmen lesen (für Vorbestelldialog)
    { resource: AppResource.OPENING_HOUR_EXCEPTIONS, action: AppAction.READ },

    // Zeiterfassung erlauben (USERS_TIME_CLOCK)
    { resource: AppResource.WORKING_TIMES, action: [AppAction.CREATE, AppAction.READ, AppAction.UPDATE] },
    AppAbility.CAN_CLOCK_IN,

    // Drucken erlauben
    { resource: AppResource.PRINT_SERVER, action: AppAction.CREATE },

    // Tageseröffnung/Tagesabschluss am Edge ausloesen (openDay/closeDay)
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.MANAGE },

    // Eigene Kassenlade(n) am POS eröffnen/zählen/schließen (edge-nativ).
    // Self-Scope (nur eigene Lade) erzwingt der restrictCashSessionToOwner-Hook.
    { resource: AppResource.CASH_SESSIONS, action: [AppAction.READ, AppAction.CREATE, AppAction.UPDATE] },

    // Kasse darf natürlich kassieren
    AppAbility.CAN_DISCOUNT,
    AppAbility.CAN_REFUND,
    AppAbility.CAN_VOID_ORDER,
  ],

  // 2. KITCHEN DISPLAY (KDS)
  // Alt: ORDERS_READ, ORDERS_UPDATE, PRODUCTS_READ
  [UserSystemRole.DEVICE_KDS]: [
    // Darf Bestellungen sehen und Status ändern (z.B. auf "Fertig")
    { resource: AppResource.ORDERS, action: [AppAction.READ, AppAction.UPDATE] },

    // Muss Produkte lesen können (Namen, Zutaten)
    { resource: AppResource.PRODUCTS, action: AppAction.READ },

    // Drucken erlauben (z.B. Bon nachdrucken)
    { resource: AppResource.PRINT_SERVER, action: AppAction.CREATE },

    // KDS darf KEINE neuen Orders anlegen und KEINE User sehen!
  ],

  // 3. TABLET (Mobiler Kellner)
  // Alt: ORDERS_READ, ORDERS_CREATE, PRODUCTS_READ, USERS_TIME_CLOCK
  [UserSystemRole.DEVICE_TABLET]: [
    // Darf Orders aufnehmen (Create) und sehen (Read), aber evtl. nicht löschen (Delete)
    { resource: AppResource.ORDERS, action: [AppAction.READ, AppAction.CREATE, AppAction.UPDATE] },
    { resource: AppResource.ORDER_INTERACTIONS, action: [AppAction.READ, AppAction.CREATE] },

    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.DISCOUNTS, action: AppAction.READ },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },
    { resource: AppResource.USERS, action: AppAction.READ }, // Für Login

    { resource: AppResource.WORKING_TIMES, action: [AppAction.CREATE, AppAction.READ, AppAction.UPDATE] },
    AppAbility.CAN_CLOCK_IN,
  ],

  // 4. KIOSK (Selbstbedienung)
  // Ein Kiosk darf nur bestellen und bezahlen, aber NIEMALS User sehen oder stornieren.
  [UserSystemRole.DEVICE_KIOSK]: [
    // Darf Produkte und Menüs lesen (um sie anzuzeigen)
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },

    // Darf neue Bestellungen aufgeben (Create)
    { resource: AppResource.ORDERS, action: AppAction.CREATE },

    // Darf den Status seiner EIGENEN Bestellung prüfen (Read)
    { resource: AppResource.ORDERS, action: AppAction.READ },

    // Darf bezahlen (Discount/Refund verboten!)
    // Evtl. braucht er Payment-Rechte, aber das regelt meist der Payment-Provider direkt.
  ],
}
