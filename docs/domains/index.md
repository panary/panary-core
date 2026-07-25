# Domains

Domain-Konzepte & Business-Logik — fachliche Modelle, Berechnungsregeln, Randfälle
(`type: Domain Concept`).

* [Admin-Bestellungen — Geschäftstag-Filter + Status-Änderung](admin-bestellungen-geschaeftstag-filter.md) - Edge-Admin-Bestellliste filtert standardmäßig nach dem aktuellen Geschäftstag und erlaubt Status-Änderungen samt RBAC-Erweiterung, um hängengebliebene Orders aufzuräumen.
* [Geräte-Online-Tracking (Edge) — Echtzeit-Verbindungszählung + Admin-Panel](geraete-online-tracking.md) - Read-only Service device-connections zählt live verbundene Geräte am Edge und speist Dashboard-KPI, Sidebar-Badge und read-only Geräteliste im Admin-Panel.
* [Geschäftstag — Automatische Rotation (Standalone) + Zeit-Guard](geschaeftstag-auto-rotation.md) - Nightly Rotations-Worker rotiert den Geschäftstag zeitgesteuert und ein Zeit-Guard verweigert neue Bestellungen, wenn der Tag länger als 24 Stunden offen ist.
* [Location.businessType — Betriebstyp als kanonisches Stammdatenfeld](location-business-type.md) - Optionales StringEnum businessType am Standort als Single Source of Truth für Storefront-Onboarding-Vorauswahl, Theme-Store-Empfehlungen und perspektivische POS-Defaults.
* [POS-Pairing-Wizard — Cloud-Default + lokaler Hub (mDNS/QR/manuell)](pos-pairing-wizard.md) - Geführte POS-Inbetriebnahme mit Panary-Cloud-Default und lokaler Hub-Erkennung via mDNS, QR oder manueller IP samt single-use Pairing-Code-Flow.
* [Rabatte — Datenmodell, Anwendungslogik & Sync](rabatte.md) - Rabattsystem für POS und Storefront: Domänen-Lib @panary/discounts/domain, Anwendung über order.appliedDiscounts mit MwSt-Extraktion, Automatik-Hook, Personalessen, discount-mutex und Edge-Sync.
* [Tagesabschluss-Architektur (Edge + Cloud + Aggregator-Lib)](tagesabschluss-architektur.md) - Dreischichtiger Tagesabschluss-Workflow: Lifecycle-Maschine im Edge, Cloud-Report-Aggregation und geteilte Aggregator-Lib als Single Source of Truth, mit Mode-Unterscheidung orders-only versus pos-cashier.
* [Verbrauchs-Explosion (computeCogs / explodeOrderConsumption)](verbrauchs-explosion.md) - Single Source of Truth der Material-Verbrauchsrechnung: explodeOrderConsumption und computeCogs zerlegen Orders proportional in Zutatenverbrauch, bewusst ohne Einheiten-Umrechnung.
