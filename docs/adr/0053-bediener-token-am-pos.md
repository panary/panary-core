---
type: ADR
title: 'Bediener-Token am POS: Der Edge belegt, wer an der Kasse per PIN angemeldet ist'
description: 'ADR zum angemeldeten POS-Bediener: Bisher stand er nur in localStorage.pos_current_user und ließ sich am Gerät überschreiben; verifyPin stellt deshalb an Geräte-Verbindungen ein vom Edge signiertes, gerätegebundenes, 12 h gültiges Token mit eigener Audience aus, das der App-Hook resolvePosOperator als params.posOperator auswertet. Ungültige Token werden nur gekennzeichnet, nie abgelehnt; erzwingen muss die Berechtigung (Storno), die Zurechnung fällt auf „unbelegt“ zurück.'
tags: [users, orders, pos, edge, security, devices]
status: stable
decision: accepted
implementation: 'Schritte 1–3 und 4a umgesetzt 2026-10-05 (#619): Ausstellung in verifyPin, Prüfung und Kennzeichnung in resolvePosOperator, POS speichert und sendet das Token, Edge verlangt für Stornos von Geräten ein Manager-Token (requireOrderCancelAuthorization). Schritt 4b (Zurechnung aus dem Token) offen.'
generated: { by: claude-code/opus-5.5, at: 2026-10-05T16:00:00Z }
---

# Bediener-Token am POS

## Problem

Der POS verbindet sich als Gerät: `params.user` ist am Edge der virtuelle User
`device:<uuid>` aus `allowApiKey`. Welcher Mensch per PIN angemeldet ist, wusste bis
[#619](https://github.com/panary/panary-core/issues/619) nur der Client, und zwar in
`localStorage.pos_current_user`. Jeder am Gerät kann das in den DevTools überschreiben.

Diese ID wird an mehreren Stellen ungeprüft übernommen:

| Stelle | Wirkung |
| --- | --- |
| `cancel-order-dialog` `#posUserId` | **Berechtigung:** Ein Manager oder Inhaber storniert ohne PIN (#608) |
| `active-orders` `#resolveCashierId` | `performedBy` beim Kassieren; der Edge leitet daraus `openedBy` der Kassensitzung ab |
| Bestell-Dialog | `creationContext.createdBy` |
| Abschreibungs-Dialog | Bediener der Abschreibung |
| Storno-Journal | `userId` des `order-cancel` ([ADR 0052](0052-journal-ereignisse-nach-annahme-schreibt-der-pos.md)) |

Auch der Storno **mit** PIN wird nur am POS geprüft. Der Edge nimmt jeden Storno-Patch
eines Geräts an. Eine reine Verschärfung der Oberfläche hebt also nur die Hürde, eine
Grenze ist sie nicht.

## Entscheidung

**`users.verifyPin` stellt an Geräte-Verbindungen zusätzlich ein Bediener-Token aus.**
Ein App-Hook wertet es aus. Gewählt von Michael am 2026-10-05 unter drei Wegen (Issue-Kommentar).

- **Ausstellung:** Nach erfolgreichem PIN gibt `verifyPin` zusätzlich `operatorToken` und
  `operatorTokenExpiresAt` (ISO) zurück. Das Token ist ein JWT über den
  `AuthenticationService` des Edge mit `sub` = User, `deviceId` und `tenantId` der
  Socket-Connection und `typ: 'pos-operator'`. Es läuft nach 12 h ab
  (`utils/pos-operator-token.ts`).
  Ausgestellt wird nur, wenn die Connection vom Geräte-Handshake gestempelt ist
  (`apiKey: true`, `deviceId`). Interne Aufrufe wie die Kassen-Freigabe in `cash-sessions`
  und JWT-Sessions bekommen keines, weil es kein Gerät gibt, an das es sich binden ließe.
- **Eigene Audience** `urn:panary:pos-operator`. Das ist die tragende Trennung: Mit der
  Standard-Audience wäre das Token ein vollwertiges Access-Token, und ein Terminal bekäme mit
  dem PIN eines Managers dessen JWT-Session. Umgekehrt fällt ein Access-Token hier an der
  Audience durch.
- **Transport:** Der POS schickt das Token in `params.query.operatorToken` mit. Über den Socket
  kommen je Aufruf nur `data` und `query` an, keine Header. Die Daten-Schemas sind teils
  geschlossen (`orderPatchSchema`, ADR 0052), und ein Body-Feld müsste in jedes Schema.
- **Prüfung:** Der App-Hook `resolvePosOperator` läuft hinter `allowApiKey` und
  `requireDeviceReverification`, vor `secureByDefault`. Er entfernt den Schlüssel **immer**
  aus der Query, auch bei Ablehnung, damit weder ein Query-Validator noch ein Adapter ihn
  sieht. Geprüft werden Signatur, Audience, Ablauf, Typ, dasselbe Gerät und derselbe
  Mandant wie die Connection. Dazu liest der Hook das Konto frisch: Es muss existieren, aktiv
  sein und zum Mandanten passen, aus demselben Grund wie bei `EdgeJWTStrategy` (#187). Gültig
  → `params.posOperator = { userId, role, tenantId }`, mit `role` aus der DB, nicht aus dem
  Token. Ungültig → `params.posOperatorRejected = true`, und der Aufruf läuft **weiter**
  (Nachtrag unten). Der Grund steht als `security.pos_operator_token_rejected` im Log. Das
  Token selbst wird nie geloggt.
- **Kein Token → keine Wirkung.** Der Hook belegt nur; was ohne Beleg geschieht, entscheidet die
  jeweilige Stelle.

### Nachtrag 2026-10-05: Berechtigung und Zurechnung getrennt

Entschieden von Michael nach Schritt 1 (Issue-Kommentar). Anlass war die Outbox:
`classifyOutboxError` stuft 401 als `terminal` ein und verwirft den Eintrag. Ein offline
erfasster Auftrag, der erst nach Ablauf des Tokens nachgesendet wird, ginge an einer Ablehnung
verloren. Ein verlorener Bon wiegt schwerer als ein nicht belegter Bediener.

| Art | Beispiele | Ohne gültiges Token |
| --- | --- | --- |
| **Berechtigung** | Storno ohne PIN, Storno überhaupt | abgelehnt. Läuft nur online, es geht nichts verloren |
| **Zurechnung** | `performedBy`, `createdBy`, Journal-`userId` | nie abgelehnt. Gültig → Bediener aus dem Token statt aus dem Body. Fehlt oder ungültig → Body-Wert bleibt, geloggt als `security.pos_operator_unverified` |

- Der POS schreibt das bei der Erfassung gültige Token mit in den Outbox-Eintrag. Nachgesendet
  wird meist nach Minuten, das Token ist dann fast immer noch gültig.
- Eine gefälschte ID verschafft damit keine Berechtigung mehr und fällt bei der Zurechnung auf.
  Unmöglich wird sie dort nicht — der Kompromiss mit Offline-First.
- „Unbelegt“ steht zunächst nur im Log. Ein Feld an Order, Abschreibung und Journal (Migration
  am Edge, Sync in der Cloud) kommt erst, wenn jemand die Auswertung braucht.
- Deshalb lehnt `resolvePosOperator` seit Schritt 2 nicht mehr ab, sondern kennzeichnet.

### Schnitt

| Schritt | Inhalt |
| --- | --- |
| 1 | Edge stellt aus und prüft, wenn mitgeschickt (additiv, PR #626) |
| 2 | Edge kennzeichnet ein ungültiges Token, statt abzulehnen (Nachtrag oben) |
| 3 | POS speichert das Token beim PIN-Login zentral und sendet es bei zurechnenden Aufrufen und in Outbox-Einträgen mit |
| 4 | Edge erzwingt: Storno von Geräten nur mit Token eines Managers oder Inhabers; `performedBy`/`userId` aus `params.posOperator`, sonst „unbelegt“. Dazu gehören die Custom Methods am rohen Service, die Schritt 3 noch nicht mitsenden lässt (`cash-sessions`, Zeiterfassung) — nur `orders.split` reicht das Token schon durch |

### Am POS (Schritt 3)

- **Speicher:** `libs/shared/data-access/src/lib/utils/pos-operator-token.ts`, Schlüssel
  `pos_operator_token` neben `pos_current_user`. Den lesen sieben Stellen per `JSON.parse`, das
  Token gehört in keine davon. Der PIN-Login legt es ab und entfernt ein vorhandenes, wenn
  `verifyPin` keines liefert — sonst trüge die neue Sitzung das Token des vorigen Bedieners.
  Logout und Geräte-Reset löschen es mit `pos_current_user`.
- **Mitsenden:** `BaseService` hängt das Token an `create`, `patch`, `update` und `remove`, nicht an
  Lesezugriffe. Ein abgelaufenes wird nicht mitgeschickt. `orders.split` läuft am rohen Service und
  reicht es selbst durch.
- **Vorrang und Unterdrückung:** Ein vom Aufrufer gesetztes Token gewinnt. `operatorToken: null`
  heißt „ausdrücklich keines“. Der Storno nach Manager-PIN schickt so das Token des Managers, oder
  — liefert dessen `verifyPin` keines — ausdrücklich keines statt des Kassierer-Tokens.
- **Outbox:** Der Eintrag trägt das Token der Erfassung (`operatorToken`), der Nachversand schickt
  genau dieses, nicht das des gerade angemeldeten Bedieners. Ohne Token geht kein Schlüssel mit,
  weil der rohe Service kein `null` entfernt.

### Storno am Edge (Schritt 4a)

`requireOrderCancelAuthorization` sitzt am `orders`-Patch hinter `validateOrderStatusTransition`
und vor allen Kassen- und TSE-Hooks. Ein externer Patch eines **Geräts** auf `ABORTED` braucht
`params.posOperator` mit der Rolle Manager oder Inhaber (`ORDER_CANCEL_AUTHORIZING_ROLES`, frisch
aus der DB). Sonst `403` mit `data.code: 'ORDER_CANCEL_NOT_AUTHORIZED'` und
`security.order_cancel_unauthorized` im Log. JWT-Sessions im Admin und interne Aufrufe sind nicht
betroffen.

Der Storno-Dialog bietet den Direktweg nur noch an, wenn ein eigenes Token vorliegt, und führt nach
genau dieser Ablehnung auf die Personenauswahl mit PIN zurück — statt einer Fehlermeldung. So
endet eine gefälschte `pos_current_user._id` im PIN-Schritt.

Der Hook greift auch beim `create`: Eine gleich als `ABORTED` angelegte Bestellung wäre derselbe
Storno ohne Freigabe. Ein wiederholter Storno einer schon stornierten Bestellung geht ohne Token
durch — er bucht nichts Neues, und abgelehnt läge ein verlorener Nachversand-Ack sonst als
„terminal“ unter den gescheiterten Übertragungen.

**Grenze:** Ein Manager-Token ist an Gerät und Mensch gebunden, nicht an eine Bestellung. Wer
nach einer echten Freigabe per PIN am selben Terminal weiterarbeitet, kann bis zum Ablauf (12 h)
weitere Stornos mit diesem Token auslösen — sofern er an das Token im Speicher des Geräts kommt.
Eine Bindung je Storno (Einmal-Token) wäre die nächste Stufe; sie ist hier bewusst nicht gebaut.

⚠️ Ein offline erfasster Storno, der erst nach Ablauf des Tokens nachgesendet wird, wird
abgelehnt (403, im Nachversand terminal) und erscheint unter den abgelehnten Übertragungen. Das
ist Absicht: Eine Berechtigung, die sich durch Warten erschleichen ließe, wäre keine.

POS und Edge werden getrennt ausgerollt. 🚨 Schritt 3 darf erst auf Geräte, wenn ein Edge-Release
mit Schritt 2 läuft — gegen einen Edge aus Schritt 1 ginge ein Outbox-Eintrag mit abgelaufenem
Token an der Ablehnung verloren.

🚨 **Und Schritt 4a erst auf den Edge, wenn auf allen Geräten ein POS mit Schritt 3 läuft.** Ein
älterer POS schickt kein Token; gegen einen Edge mit 4a scheitert dort jeder Storno, auch der mit
Manager-PIN. Reihenfolge also: `v*` mit Schritt 2 → `pos-v*` mit Schritt 3 → `v*` mit Schritt 4a.

### Verworfen

- **Bediener an die Geräte-Session binden.** Der Edge würde sich je Gerät merken, wer angemeldet
  ist. `verifyPin` dient aber auch der Freigabe durch Dritte (Storno-PIN, Kassen-Freigabe), und
  jede Freigabe würde den angemeldeten Bediener umschalten. Dafür bräuchte es eine zweite
  Login-Methode, und der Zustand ginge beim Reconnect verloren, wenn er nicht persistiert wird.
- **Nur den Storno-Direktpfad clientseitig verschärfen**, etwa mit einem Zeitfenster seit dem
  Login. Das bleibt in den DevTools fälschbar und erreicht das Ziel von #619 nicht.

## Konsequenzen

- Ein Token belegt „dieser Mensch hat an diesem Terminal seinen PIN eingegeben“. Wer
  `pos_current_user` überschreibt, hat keines, und nach Schritt 4 verschafft ihm die gefälschte ID
  keine Berechtigung mehr und fällt bei der Zurechnung auf.
- **Offline-First bleibt erhalten:** Ausstellung und Prüfung laufen nur am Edge, die Cloud ist
  nicht beteiligt.
- **Geräte-Zuweisung (#131) und PIN-Wechsel:** `verifyPin` prüft die Zuweisung bei der
  Ausstellung. Wird sie danach entzogen oder der PIN gewechselt, gilt das Token bis zum Ablauf
  weiter. Archivieren wirkt sofort, Umzuweisen und PIN-Wechsel nicht.
- **Mandant strikt:** Konto und Gerät müssen denselben Mandanten tragen, auch wenn eine Seite
  leer ist. Nach dem Pairing stempelt `applyCloudTenantId` jedes Konto um.
- **Laufzeit 12 h:** Sie entspricht einer Schicht mit Reserve. Der Inaktivitäts-Logout am POS
  beendet die Sitzung meist früher. Eine längere Schicht verlangt eine neue PIN-Eingabe.
- **Restannahme:** Wer das Gerät und dessen Geräte-Schlüssel vollständig kontrolliert, bleibt
  außerhalb, wie im Issue festgehalten.
