---
title: Fiskalisierung-Architektur — Cloud-direkt + Entkopplung von Offline-First
date: 2026-05-27
category: Architektur
domains: [tse, tenants, locations, orders, businessdays]
status: Aktiv (Entscheidung; Implementierung phasenweise)
---

# Fiskalisierung-Architektur (KassenSichV) — Dual-Mode

ADR zur TSE-Architektur im Dual-Mode (POS am Edge vs. POS direkt an der Cloud).
**Ersetzt teilweise** die Kopplung „`offlinePos` ⇒ `pos-cashier`" aus
[`subscription-tier-modell.md`](subscription-tier-modell.md) und die Edge-only-
Annahme aus [`tse-integration.md`](tse-integration.md).

## Problem / Auslöser

Onboarding-Vision: ein Gastronom soll in **unter 10 Minuten voll einsatzfähig**
sein — Account → Trial → POS-Client **direkt an der Cloud** koppeln → (bei
gebuchter Fiskal-Subscription) automatisch TSE → Speisekarte scannen → Storefront
→ sofort bestellen + kassieren. **Ohne** Hardware-Bestellung / Edge-Versand /
Inbetriebnahme durch uns.

Das bisherige Modell koppelt fiskalischen Kassenbetrieb (`pos-cashier` + TSE) an
das Feature `offlinePos` (= Edge): `enforce-operation-mode.hook` erzwingt für
Pläne ohne `offlinePos` `orders-only` und blockt `pos-cashier`. Damit wäre
fiskalisches Kassieren **nur mit Edge** möglich → widerspricht der „in Minuten,
ohne Hardware"-Vision.

## Schlüssel-Erkenntnis

**Fiskaly ist eine Online-/Cloud-TSE** (HTTP-API, keine lokale Hardware). Die
**Cloud kann selbst signieren** — ein cloud-direkt gekoppelter POS ist voll
fiskalisch, ohne Edge. „Fiskalisierung" und „Offline-First" sind **zwei
unabhängige Achsen**, die das alte Modell fälschlich vermischte.

## Entscheidung

1. **Fiskalisierung = eigenes Feature/Add-on** (`fiscalCashier`), buchbar quer
   über Tiers — **nicht** an `offlinePos`/Edge gekoppelt. Cloud-direkt fiskalisch
   ist ein **erstklassiger** Pfad (der Onboarding-Standardweg).
2. **`offlinePos`/Edge = Resilienz-Upsell** (Offline-Pufferung bei Internet-Ausfall,
   §146a) — Voraussetzung für *Ausfallsicherheit*, nicht fürs Kassieren.
3. **Signieren provider-agnostisch aus dem geteilten `TsePort`**, ausführbar in
   **Cloud (api-cloud → Fiskaly) UND Edge**. Trigger ist ausschließlich
   `location.operationMode === 'pos-cashier'` — identisch in Edge und Cloud, in
   einem **geteilten Domain-Helfer** gekapselt (keine Doppel-Logik).
4. **Single fiscal source — „Erzeuger signiert":** Die Cloud signiert nur native
   cloud-direkte Orders; **synchronisierte Edge-Orders werden NIE re-signiert**.
   Guards: `params.fromSync` **und** bereits gesetztes `order.tse` (geprüft am
   *geladenen* Datensatz, nicht nur an `data`) — greifend in create **und** patch
   (inkl. Soft-Delete-Patch-Pfad, der kein `fromSync` trägt).
5. **Lückenloser Fiskal-Zähler** pro Location, **getrennt** von der Bestell-/
   Bonnummer (`dailySequenceNumber` bleibt reine Anzeige). Der monotone,
   lückenlose Zähler läuft **nur bei TSE-signierten Vorgängen** (korrigiert
   Defekt S1). `orders-only` braucht ihn nicht.
6. **Storno/Refund werden TSE-signiert** (`tsePort.cancelTransaction`) im
   Fiskal-Pfad (schließt Defekt S2).
7. **Fail-closed:** Lässt sich Fiskal-Status/Provider nicht ermitteln, wird im
   fiskalischen Kontext **nicht** durchgelassen (kein fail-open).

## Caveat (bewusst akzeptiert)

Cloud-direkt fiskalisch **braucht Internet am Point-of-Sale** (Tap-to-Pay-Karten
ohnehin). Fällt das Netz, gibt es keinen lokalen Puffer. Produkt-Narrativ:
**„Start in Minuten cloud-direkt; Edge-Appliance später für Offline-Sicherheit
dazubuchen."** Die bestehende Edge-Signier-Arbeit wird damit zum Premium-
Resilienz-Tier — nicht verworfen.

(Zahlungs-Provider sind separat: Tap-to-Pay via Stripe, Subscription-Billing via
Mollie — siehe panary-cloud `billing-provider-strategie-adr.md`. TSE = fiskalische
Signatur, unabhängig vom Zahlungsweg.)

## Konsequenzen / was korrigiert wird

- **`subscription-tier-modell.md`:** `offlinePos` gated NICHT mehr `pos-cashier`;
  neues Feature `fiscalCashier`. Fiskalisierung wird Add-on; Edge/Offline separat.
- **`enforce-operation-mode.hook` / panary-cloud `plan-limit-enforcement.md`:** Gate
  wechselt von `offlinePos` auf `fiscalCashier`; zusätzlich der Doppelsignier-Schutz
  beim Sync-Push (`fromSync`).
- **`tse-integration.md`:** Cloud-direkt fiskalisch first-class; Edge = Resilienz;
  Order-Signier-Hooks gaten auf `pos-cashier`; separater Fiskal-Zähler;
  Storno-Signierung.
- **Fiskaly-Real-Adapter** bleibt die harte Go-Live-Abhängigkeit (Credentials);
  bis dahin alles simulator-getestet.

## Offene Punkte (im Implementierungsplan zu klären)

- Cloud-Secret-Auflösung: AES-in-DB (`secret-cipher.ts`) vs. BWS-Direkt-Lookup
  (Empfehlung: AES-in-DB, Infrastruktur steht).
- Heimat + Vergabe des Fiskal-Zählers (pro Location; Kollisionsfreiheit bei
  Edge/Cloud-Mischbetrieb desselben Tenants).
- Feature-Benennung (`fiscalCashier`) + Mapping in den Subscription-Plänen
  (eigenes Add-on, nicht Tier-gebunden).

## Status

Entschieden 2026-05-27. Implementierung phasenweise (separater Plan), bis zur
Fiskaly-Credential-Grenze simulator-getestet.
