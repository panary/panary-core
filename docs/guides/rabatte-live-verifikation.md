---
type: Guide
title: 'Rabatte am laufenden Stack verifizieren'
description: 'Prüfblatt für den Rabatt-Durchstich Cloud → Sync → Edge → POS inklusive MwSt-Gegenprobe, mit den Schritten, die nur an echter Hardware laufen.'
tags: [discounts, orders, pos, testing]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-14T20:00:00Z }
---

# Rabatte am laufenden Stack verifizieren

Prüfblatt aus der Live-Verifikation zu [panary/panary-core#182](https://github.com/panary/panary-core/issues/182).
Der **API-Teil** ist dort einmal gefahren und in [rabatte.md](../domains/rabatte.md#live-verifikation-am-stack-2026-08-14)
mit Messwerten festgehalten; dieses Blatt beschreibt, wie man ihn wiederholt — und die
Schritte, die eine echte Kasse brauchen und deshalb offen sind.

> ⚠️ **Warum überhaupt von Hand?** Der fiskalische Teil ist KassenSichV-relevant, und eine
> grüne Testsuite beweist ihn nicht: Erwartung und Implementierung stammen aus derselben
> Herleitung. Die Regel für dieses Blatt lautet deshalb: **Erwartungswerte vor dem Lauf
> ausrechnen und aufschreiben**, dann messen. Wer erst misst und danach beurteilt, ob die
> Zahl plausibel aussieht, prüft nichts.

## 1. Stack starten

Drei Prozesse, in dieser Reihenfolge (die Edge verbindet sich gegen die Cloud):

```bash
docker start mongodb                              # falls nicht schon oben
pnpm --dir panary-cloud exec nx serve api-cloud   # Port 3031
pnpm --dir panary-core  exec nx serve api-edge    # Port 3030
pnpm --dir panary-core  exec nx serve pos-client  # Port 4200
```

🚨 **Gesundheit der Edge nur über den Content-Type prüfen, nie über den Status-Code.** Im
SETUP MODE beantwortet die Setup-SPA *jede* Route mit HTTP 200:

```bash
curl -s -o /dev/null -w "%{content_type}\n" http://localhost:3030/health
# application/json = gesund   |   text/html = SETUP MODE = kaputt
```

Läuft die Verifikation aus einem Worktree, braucht dessen `data/` eine Kopie von
`api-edge.sqlite` **und** `panary.config.json` — sonst startet die Edge im SETUP MODE. Vor
dem Start prüfen, dass `SELECT cloudUrl FROM 'cloud-connection'` auf `http://localhost:3031`
zeigt und nicht in eine echte Cloud.

## 2. Sync-Durchstich

Rabatt in der Cloud anlegen (Admin-UI oder API), dann an der Edge nachsehen:

```bash
sqlite3 data/api-edge.sqlite \
  "SELECT name, isStaffMeal, combinable, channels, updatedAt FROM discounts;"
```

Worauf es ankommt — hier zeigen sich Sync-Fehler zuerst:

- [ ] `isStaffMeal`/`combinable` stehen als **0/1** in SQLite, kommen über die API aber als
      echte `boolean` zurück (`registerMongoService.booleanFields`). Kippt das, scheitert der
      Push mit „must be boolean".
- [ ] `channels` ist in der DB ein JSON-String, über die API ein **Array**.
- [ ] `updatedAt` ist ein ISO-String. Wird daraus ein Date-Objekt, matcht der Pull nie mehr.

Dann die Query stellen, die der Picker stellt (`DiscountService.loadActivePosDiscounts`):

```bash
curl -s -H "Authorization: Bearer <jwt>" \
  'http://localhost:3030/discounts?status=ACTIVE&method=manual&$limit=200'
```

- [ ] Der neue Rabatt ist dabei, und `channels` enthält `pos`.

## 3. Rechenprobe (vor dem Klicken ausrechnen!)

Beispiel, das beide Steuersätze mischt — außer Haus, also `taxOutside`:

| Position | Brutto | Satz |
|---|---|---|
| 2 × Nuggets à 4,50 € | 9,00 € | 7 % |
| 1 × Apfelschorle | 2,90 € | 19 % |
| **Summe** | **11,90 €** | |

Mit 20 % Rabatt, von Hand nach § 10 Abs. 1 Satz 2 UStG (netto = brutto / (1 + p/100)):

```
Rabatt      = round(1190 × 20/100)               = 238 ct
Verteilung    7 %: 238 × 900/1190 = 180          19 %: 238 × 290/1190 = 58
Neue Eimer    7 %: 900 − 180 = 720               19 %: 290 − 58 = 232
Extraktion    720 / 1,07 = 672,90 → netto 673    232 / 1,19 = 194,96 → netto 195
              steuer 720 − 673 =  47             steuer 232 − 195 =  37
Gesamt        brutto 952 · netto 868 · steuer 84         (868 + 84 = 952 ✓)
```

- [ ] `order.taxSnapshot` trifft diese Zahlen **cent-genau**.
- [ ] `appliedDiscounts[0].computedAmountCents` ist 238 (serverseitig gefüllt, nicht vom Client).

⚠️ Gerundet wird **je Steuersatz**, nicht je Position (§ 14 Abs. 4 Nr. 8 UStG). Drei
19-%-Positionen ergeben einen Rundungsschritt, nicht drei.

## 4. Guards

- [ ] Ein `create`/`patch` mit dem Schlüssel `discount` wird mit **400** abgelehnt — auch
      `discount: null`. Das Feld ist seit [ADR 0030](../adr/0030-legacy-rabattfeld-abgeschafft.md)
      abgeschafft; es gibt nur `appliedDiscounts`.
- [ ] Personalessen-Bestellung (`staffPaymentInfo` gesetzt) + zweiter Rabatt → **400**
      „Personalessen-Bestellungen erlauben keine zusätzlichen Rabatte".
- [ ] Personalessen allein: `staffPaymentInfo` gestempelt, Preis reduziert.

## 5. Tagesabschluss

- [ ] `discountsCount` zählt **pro Order**, nicht pro Rabatt-Eintrag — zwei Rabatte auf einer
      Bestellung sind *eine* rabattierte Order.
- [ ] `discountsCents` ist die Summe der `computedAmountCents`.
- [ ] ⚠️ Die Cloud-Karte „Finanzen" zeigt weiterhin **0**, solange
      `LIVE_KPI_ORDER_PROJECTION` `appliedDiscounts` wegschneidet
      (panary/panary-cloud#253). Das ist erwartet und kein Fehler der Edge-Rechnung.

## 6. Was nur an echter Hardware geht

Diese Schritte sind in #182 **nicht** abgehakt worden — sie brauchen eine gepairte Kasse:

- [ ] **UI-Klickpfad des Pickers:** „Rabatt"-Knopf → Dialog listet die aktiven POS-Rabatte →
      Auswahl zeigt durchgestrichenen Originalpreis und den neuen Betrag → `deleteOrder()`
      setzt zurück.
- [ ] **`patch`-Pfad:** Rabatt an einer bestehenden Bestellung ändern. Erreicht nur die Rolle
      `DEVICE_POS`, und die geht ausschließlich über eine Socket-Verbindung mit API-Key —
      per REST nicht testbar (`allowApiKey` verlangt `params.connection.apiKey`).
- [ ] **Rabattcode-Gutfall:** „Prüfen" zeigt den Nachlass **ohne** zu verbrauchen; erst
      `placeOrder` löst ein. Braucht ein gültiges Edge↔Cloud-Pairing.
- [ ] **Rabattcode-Kollision:** zwei Kassen auf demselben `usageLimit: 1` — die zweite läuft
      **ohne** Code weiter (mit Hinweis), statt die Bestellung zu verlieren.
- [ ] **Gedruckter Bon:** Papierformat und Umbruch. ⚠️ Der Nachlass steht dort derzeit
      **nicht** (panary/panary-core#228) — der MwSt-Split dagegen schon.

Den Ausfallpfad des Rabattcodes kann man dagegen jederzeit auslösen: api-cloud stoppen und
prüfen, dass die Meldung **amber** (technisch, `cloud_unreachable`) ist und nicht rot
(„Code ungültig"). Ein `401`/`429`/`5xx` der Cloud zählt immer als technisch.
