---
title: Subscription-Tier-Modell (Connect / Operate / Enterprise)
date: 2026-05-27
category: Architektur
domains: [tenants]
status: Aktiv
---

# Subscription-Tier-Modell

ADR zum freigegebenen Pricing-Modell und der Umstellung der `subscription-plans`-Seed-Daten
und Feature-Flags in [`@panary/tenants/domain`](../libs/domains/tenants/domain/src/lib/subscription-plan.schema.ts).

## Problem

Die ursprünglichen Seed-Pläne (`starter` €29 ohne AI, `professional` €79) waren gegenüber
dem real gebauten Funktionsumfang (Offline-First-POS, Fraud-Analytics, KI-Wareneingang,
Personal-Suite, Tagesabschluss) deutlich unterbewertet — und mischten „Funktionsumfang"
und „Betriebsumfang" als Differenzierungsachsen, was zum „Standard-Feature-hinter-Paywall"-
Vorwurf einlädt.

## Entscheidung

**Leitprinzip:** „Das ganze Gehirn in jedem Plan." Alle End-User-Software-Features sind in
jedem zahlenden Tier enthalten. Differenziert wird über (a) Betriebs-Capability, (b)
Skalierung/Integration.

**Tiers (per Location, Mengenrabatt):**

| Plan | Preis | Location-Modus | Kern |
|---|---|---|---|
| `trial` | €0, 60 Tage | — | voller Operate-Funktionsumfang, 1 Filiale |
| `connect` | €29 | `orders-only` | Cloud-Bestellung + volles Backend + KI + Fraud, **kein** Offline-POS/Druck |
| `operate` | €89 | `pos-cashier` | + Offline-First-POS + physischer Print-Server/KDS + Fiskal-Z-Bon |
| `enterprise` | Custom | `pos-cashier` | + API / Webhooks / SSO / Audit-Export, unbegrenzte Skalierung |

**Feature-Flags (closed enum) — neu sortiert:**

- **In allen Plänen `true`:** `aiExtraction`, `fraudAnalytics` *(ersetzt `advancedReporting`)*,
  `multiLocationConsolidation` *(ersetzt das alte Hard-Gate `multiLocation`)*.
- **Betriebs-Capability (operate/enterprise):** `offlinePos`, `physicalPrintServer` *(neu)* —
  trennen Connect (`orders-only`) von Operate (`pos-cashier`).
- **Enterprise-Gate:** `apiAccess`, `webhookSubscriptions`, `sso`, `auditTrailExport`,
  `customDomain`, `prioritySupport` — echte Grenzkosten/Sicherheitsfläche.

## Mengenrabatt-Berechnung

Kanonische Quote-Logik in [`subscription-pricing.ts`](../libs/domains/tenants/domain/src/lib/subscription-pricing.ts)
(`computeSubscriptionQuote`, `VOLUME_DISCOUNT_TIERS`): Per-Location-Listenpreis × Filialzahl mit
Stufen 1–2 = 0 %, ab 3 = −15 %, ab 10 = −25 %, ab 25 = −35 % + `requiresEnterpriseQuote`.
Rundung **pro Filiale** (spiegelt Stripe-Quantity-Abrechnung). Single Source für Admin-UI-Anzeige
und perspektivisch das Stripe-Tiered-Pricing-Setup — Stripe bleibt Billing-Wahrheit, die Tier-
Schwellen müssen identisch gehalten werden.

## Konsequenzen

- **Seed-IDs geändert:** `starter`/`professional` → `connect`/`operate`. Pre-Launch ohne
  Datenmigration; bestehende Tenant-`planCode`-Referenzen müssten sonst gemappt werden.
- **`offlinePos` ist der Enforcement-Anker** für das operationMode-Gate (Cloud-Seite, siehe
  panary-cloud `documentation/plan-limit-enforcement.md`).
- **Cloud-Konsum via Option C:** Lokal greift die Änderung sofort (Workspace); für Prod muss
  `PANARY_CORE_REF` in panary-cloud gebumpt werden, sonst kennt die Cloud `offlinePos`/`fraudAnalytics` nicht.
- **TSE** bleibt optionales Add-on (Online-TSE via Fiskaly, Schema `tenant.tse` mit BWS-Secret-Refs).
- Vollständige Markt-/Begründungsanalyse: Pricing-Empfehlungsplan (außerhalb des Repos).
