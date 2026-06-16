---
title: Offline-Cache (Connect-Tier) — Smoke-Test-Anleitung
date: 2026-06-15
category: Guide
domains: [sync, orders, products, devices]
status: active
---

# Offline-Cache (Connect-Tier) — Smoke-Test-Anleitung

Manuelle Verifikation des schlanken Offline-Cache + Outbox im POS-Client (Connect-Tier,
cloud-direkt). Diese Anleitung führt **penibel** durch jeden ausgelieferten Pfad der Phasen 1–5.

> **Geltungsbereich:** `apps/pos-client` im **Connect-Tier** (gepairtes Gerät, cloud-direkt, **ohne**
> Edge-Hub). Offline ⇒ **nur Bargeld**. Geschäftstag muss **online** geöffnet sein. Single-Device.
> Architektur-Hintergrund: [offline-cache-architecture.md](offline-cache-architecture.md).

---

## 0. Vorbereitung

### 0.1 Voraussetzungen (online herstellen)

1. POS-Client starten (lokal): aus `panary-core/` → `pnpm start` (bzw. `nx serve pos-client`).
2. Gerät ist **gepairt** (DeviceConfig in `localStorage`, Schlüssel `panary_device_config` vorhanden;
   `tenantId`/`locationId`/`serverUrl` gesetzt). Falls nicht: Pairing-Wizard durchlaufen.
3. **Geschäftstag ist offen** (online geöffnet). Ohne offenen Tag nimmt der POS keine Bestellungen an —
   das ist kein Offline-Fehler.
4. Mindestens **einige Produkte + Produktgruppen** sind im Katalog vorhanden (für die Bestellaufnahme).
5. Einmal **online** im POS angemeldet bleiben, bis der Katalog sichtbar ist → der Cache bootstrappt
   (Voll-Load) im Hintergrund.

### 0.2 IndexedDB als Wahrheitsquelle (DevTools)

Den Cache jederzeit inspizieren: **DevTools → Application → Storage → IndexedDB**.

- DB-Name: `panary-cache::{tenantId}::{locationId}::{host}` (Tenant-/Location-isoliert).
- Erwartete Object-Stores: `products`, `product-groups`, `discounts`, `locations`, `orders` sowie die
  internen Stores `__cache_meta`, `__cursors`, `__outbox`.
- Nach Bootstrap sind `products`/`product-groups` befüllt; `__cursors` enthält pro Service `lastPullAt`.

### 0.3 Offline simulieren

Empfohlen: **DevTools → Network → Throttling → „Offline"**. Das trennt den Socket.IO-Transport →
`connectionState()` wechselt auf `disconnected`. (Flugmodus/WLAN-Trennung geht ebenfalls.)
**Wieder online:** Throttling zurück auf „No throttling / Online" — der Socket reconnectet automatisch.

> Den Tab dabei **nicht** schließen (reiner Reload ist erlaubt und wird in Test 8 bewusst geprüft).

---

## 1. Test: Bootstrap & Cache-Hydration (online)

**Schritte**
1. Frischer Start, online, eingeloggt, Katalog sichtbar.
2. IndexedDB öffnen (0.2).

**Erwartet**
- DB `panary-cache::…` existiert, `products`/`product-groups` enthalten Datensätze.
- `__cursors` hat pro Service einen `lastPullAt`-Eintrag (ISO-Zeitstempel).
- Keine Fehler in der Konsole.

---

## 2. Test: Offline-Erkennung & Banner

**Schritte**
1. Offline schalten (0.3).
2. Kurz warten (Socket-Disconnect, ≤ wenige Sekunden).

**Erwartet**
- Oben mittig erscheint das **Banner `connect-offline`** (gelb/Warn, Icon `wifi_off`):
  **„Offline — nur Barzahlung möglich"** mit Subline zum TSE-Ausfall.
- Der Banner ist **nicht** der rote `client-offline`-Banner mit „Neu laden"-Button — wenn dieser
  erscheint, war der Cache nicht aktiv (Gerät nicht gepairt / Bootstrap nicht gelaufen).
- Der **Katalog bleibt navigierbar** (Produktgruppen/Produkte werden aus dem Cache angezeigt).

---

## 3. Test: Offline Bar-Bestellung anlegen (optimistisch + Bon)

**Schritte**
1. Offline (Banner sichtbar).
2. Neue Bestellung anlegen (Produkte hinzufügen, wie gewohnt), abschicken.
3. Den Druck-/Bon-Dialog beachten, der nach dem Anlegen erscheint.

**Erwartet**
- Die Bestellung erscheint **sofort** in der aktiven Bestellliste (kein Server-Roundtrip).
- Im **Druck-Dialog**:
  - Belegnummer-Zeile zeigt `#<Nummer> · vorläufig` (gelb).
  - Gelber Warnblock **„Offline-Beleg — TSE-Ausfall"** mit Hinweis, dass keine TSE-Signatur möglich ist
    und die endgültige Belegnummer bei Wiederverbindung vergeben wird.
- Das **Banner** zeigt jetzt den Zähler: **„1 Bestellung(en) ausstehend …"** (steigt mit jeder weiteren
  Offline-Bestellung).
- IndexedDB: im Store `__outbox` liegt ein Eintrag (`status: pending`, `op: create`, `service: orders`);
  im Store `orders` liegt die Bestellung mit `offlineCreated: true` + `provisionalSequenceNumber`.

> Mehrere Offline-Bestellungen anlegen und prüfen, dass der Banner-Zähler korrekt mitzählt.

---

## 4. Test: Bargeld-Zwang (defensiv)

Heute hat der POS **keine** Karten-UI (Stripe = Zukunft), daher ist der reguläre Pfad bereits bargeldfrei.
Verifiziert wird die **defensive Absicherung**:

**Erwartet**
- Es gibt offline keinen Weg, eine Karten-/Online-Zahlung auszulösen.
- (Code-Garantie, nicht UI-sichtbar:) Ein offline ausgelöster Checkout mit Nicht-Bar-Transaktion würde
  mit Snackbar **„Offline ist nur Barzahlung möglich."** abgelehnt und **nicht** in die Outbox geschrieben.

---

## 5. Test: Offline Checkout / Abschluss (PATCH)

**Schritte**
1. Offline. Eine vorhandene offene Bestellung (idealerweise eine offline angelegte aus Test 3) **bar
   abschließen** (pos-cashier-Flow: Bar kassieren → abschließen).

**Erwartet**
- Der Abschluss **wirft nicht** und schlägt nicht fehl; der Status der Bestellung aktualisiert sich
  optimistisch (z. B. auf abgeschlossen/bezahlt).
- IndexedDB `__outbox`: zusätzlicher Eintrag `op: patch` (Status/Payment) für dieselbe `entityId`.
- Banner-Zähler steigt entsprechend (jede ausstehende Mutation zählt).

---

## 6. Test: Reconnect & Replay (Idempotenz)

**Schritte**
1. Wieder **online** schalten (0.3).
2. Replay abwarten (startet automatisch beim Wechsel auf `connected/authenticated`).

**Erwartet**
- Das **Banner verschwindet** (zurück auf Normalzustand).
- Die offline erzeugten Bestellungen erscheinen in der **Cloud** (z. B. im Admin-Dashboard / nach Reload
  im POS) — **ohne Duplikate** (gleiche `_id`/uuidv7 → idempotenter Replay).
- Die **endgültige `dailySequenceNumber`** ist serverseitig vergeben (Re-Stamp); der Datensatz behält
  `provisionalSequenceNumber` als Spur des Offline-Ursprungs.
- IndexedDB `__outbox` ist **geleert** (alle `pending` → acked/gelöscht); Banner-/Settings-Zähler = 0.
- **Kein** rückwirkendes TSE-Signieren (KassenSichV-Ausfallmodus bleibt dokumentiert).

> **Doppel-Check Idempotenz:** Falls währenddessen ein Netz-Flackern auftrat, darf **keine** Bestellung
> doppelt in der Cloud liegen. Bei Verdacht: in der Cloud nach gleicher `_id` suchen — es darf nur eine geben.

---

## 7. Test: Delta-Sync (Stammdaten-Aktualisierung)

**Schritte**
1. Online. Ein Produkt **in der Cloud** ändern (Preis/Name) — z. B. über das Admin-Dashboard.
2. Im POS kurz warten bzw. offline→online togglen, um einen Delta-Pull auszulösen.

**Erwartet**
- Die Änderung erscheint im POS-Katalog **ohne Voll-Reload** (Delta über `updatedAt`-Cursor).
- IndexedDB `__cursors[products].lastPullAt` ist vorgerückt; der geänderte Datensatz im `products`-Store
  trägt den neuen Wert.

---

## 8. Test: Persistenz über App-Reload (offline)

**Schritte**
1. Offline. Bestellung anlegen (Test 3).
2. App **neu laden** (F5) — **offline bleiben**.

**Erwartet**
- Nach dem Reload sind **Katalog**, die **offline angelegte Bestellung** und der **Outbox-Eintrag**
  weiterhin vorhanden (IndexedDB überlebt den Reload).
- Banner erscheint wieder mit korrektem Ausstehend-Zähler.

---

## 9. Test: Operator-Sicht (Settings → Verbindung)

**Schritte**
1. POS → **Einstellungen → Verbindung** öffnen.
2. Karte **„Offline-Warteschlange"** beachten.

**Erwartet**
- Karte zeigt **„Ausstehend"** und **„Abgelehnt"** als Zähler (reaktiv; offline mit ausstehenden
  Einträgen steht „Ausstehend" gelb > 0).
- Solange keine Mutation terminal abgelehnt wurde, ist „Abgelehnt" = 0 und es erscheint **keine**
  rote Detailliste.

### 9.1 (Optional, fortgeschritten) Abgelehnten Eintrag provozieren

Eine Mutation wird **terminal abgelehnt** (Status `rejected`), wenn der Server beim Replay einen
**terminalen** Fehler liefert (400/401/403/422 — z. B. Validierungsfehler), **nicht** bei Netz-/5xx
(die werden mit Backoff erneut versucht).

**Erwartet bei einem rejected-Eintrag**
- „Abgelehnt" > 0 (rot); darunter eine **Detailliste** mit `service · op`, Zeitpunkt und Fehlertext.
- Der Eintrag bleibt liegen (kein endloser Retry) und ist so für den Operator sichtbar.

---

## 10. Test: Staff-Logout offline gesperrt

Offline kann sich ein abgemeldeter Staff **nicht** erneut anmelden (PIN-Prüfung `verifyPin` ist
serverseitig; das Abmelden löscht zudem das Device-JWT). Daher ist Abmelden offline gesperrt.

**Schritte**
1. Offline (Banner sichtbar), als Staff am Dashboard angemeldet.
2. Den **Abmelde-Button** (Icon `logout`, oben rechts) beachten und antippen.

**Erwartet**
- Der Button ist **deaktiviert/ausgegraut** (Tooltip „Offline: Abmelden nicht möglich …").
- Ein Antippen meldet sich **nicht** ab; bei Auslösung erscheint eine Snackbar
  **„Offline: Abmelden nicht möglich — die Wiederanmeldung braucht eine Verbindung."**
- Nach Wiederverbindung (online) ist der Abmelde-Button wieder normal nutzbar.

---

## 11. Aufräumen / Reset

- **Outbox/Cache leeren:** Gerät entkoppeln (Settings → Verbindung → Danger-Zone → „Gerät entkoppeln")
  ODER in DevTools die `panary-cache::…`-DB löschen (Application → IndexedDB → Delete database).
- Nach Re-Pairing / Tenant- oder Location-Wechsel wird die alte namespaced DB ohnehin verworfen und neu
  gebootstrappt.

---

## Bekannte Grenzen (kein Test-Fehler)

- **Karten/Online offline unmöglich** (Stripe). Offline ist ausschließlich Bargeld — by design.
- **Kein rückwirkendes TSE-Signieren.** Offline-Orders bleiben als TSE-Ausfall dokumentiert; beim Replay
  läuft nur der Datensatz nach.
- **Geschäftstag** wird online geöffnet/geschlossen — offline nur innerhalb eines bereits offenen Tags.
- **Single-Device.** Keine geräteübergreifende Belegnummern-Autorität; die Offline-Nummer ist provisorisch
  und wird beim Replay vom Server **autoritativ re-gestempelt** (Belegnummer-Reconcile, cloud-seitig).
- **Replay** läuft beim Reconnect **und** zusätzlich über einen 30-s-Retry-Timer (zieht backed-off
  Einträge nach, solange etwas aussteht).
- **Produktion (cloud-seitige Teile):** Der api-cloud-TSE-Skip **und** die Belegnummer-Reconcile-Vergabe
  deployen mit einem panary-cloud-`v*`-Tag — **kein** Core-Release nötig (`offlineCreated` ist bereits im
  gepinnten Core). Lokal greift alles. Details: `panary-cloud/documentation/connect-tier-belegnummer-reconcile.md`.
