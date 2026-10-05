---
type: ADR
title: 'Bediener-Token am POS: Der Edge belegt, wer an der Kasse per PIN angemeldet ist'
description: 'ADR zum angemeldeten POS-Bediener: Bisher stand er nur in localStorage.pos_current_user und ließ sich am Gerät überschreiben; verifyPin stellt deshalb an Geräte-Verbindungen ein vom Edge signiertes, gerätegebundenes, 12 h gültiges Token mit eigener Audience aus, das der App-Hook resolvePosOperator als params.posOperator auswertet. Eingeführt in vier Schritten, Schritt 1 additiv.'
tags: [users, orders, pos, edge, security, devices]
status: stable
decision: accepted
implementation: 'Schritt 1 von 4 umgesetzt 2026-10-05 (#619): Ausstellung in verifyPin, Prüfung in resolvePosOperator. Schritte 2–4 (POS sendet mit, Edge erzwingt bei Storno und Zurechnung, Pflicht) offen.'
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
  Token. Ungültig → `NotAuthenticated` mit einheitlicher Meldung, der Grund steht als
  `security.pos_operator_token_rejected` im Log. Das Token selbst wird nie geloggt.
- **Kein Token → keine Wirkung.** In Schritt 1 läuft jeder Aufruf ohne Token wie bisher.

### Schnitt

| Schritt | Inhalt |
| --- | --- |
| 1 | Edge stellt aus und prüft, wenn mitgeschickt (dieser ADR, additiv) |
| 2 | POS speichert das Token beim PIN-Login an einer zentralen Stelle und sendet es bei zurechnenden Aufrufen mit |
| 3 | Edge erzwingt: Storno-Direktpfad nur mit Manager-Token, `performedBy`/`userId` aus `params.posOperator` statt aus dem Body |
| 4 | Übergangsphase endet: fehlendes Token wird abgewiesen |

POS und Edge werden getrennt ausgerollt. Deshalb kommt die Pflicht erst, wenn beide Seiten das
Token kennen.

### Verworfen

- **Bediener an die Geräte-Session binden.** Der Edge würde sich je Gerät merken, wer angemeldet
  ist. `verifyPin` dient aber auch der Freigabe durch Dritte (Storno-PIN, Kassen-Freigabe), und
  jede Freigabe würde den angemeldeten Bediener umschalten. Dafür bräuchte es eine zweite
  Login-Methode, und der Zustand ginge beim Reconnect verloren, wenn er nicht persistiert wird.
- **Nur den Storno-Direktpfad clientseitig verschärfen**, etwa mit einem Zeitfenster seit dem
  Login. Das bleibt in den DevTools fälschbar und erreicht das Ziel von #619 nicht.

## Konsequenzen

- Ein Token belegt „dieser Mensch hat an diesem Terminal seinen PIN eingegeben“. Wer
  `pos_current_user` überschreibt, hat keines, und nach Schritt 3 hilft ihm die gefälschte ID
  nicht mehr.
- **Offline-First bleibt erhalten:** Ausstellung und Prüfung laufen nur am Edge, die Cloud ist
  nicht beteiligt.
- 🚨 **Für Schritt 2: Outbox.** `NotAuthenticated` (401) stuft `classifyOutboxError` als
  `terminal` ein und verwirft den Eintrag. Ein offline erfasster Auftrag, der beim Nachsenden ein
  abgelaufenes Token trägt, ginge verloren. Schritt 2 darf das Token deshalb nicht ungeprüft in
  Outbox-Einträge schreiben, oder Schritt 3 muss diesen Fall anders behandeln als den
  interaktiven Aufruf. Das muss vor Schritt 2 entschieden sein.
- **Geräte-Zuweisung (#131):** `verifyPin` prüft die Zuweisung bei der Ausstellung. Wird sie
  danach entzogen, gilt das Token bis zum Ablauf weiter. Archivieren wirkt sofort, Umzuweisen
  nicht.
- **Laufzeit 12 h:** Sie entspricht einer Schicht mit Reserve. Der Inaktivitäts-Logout am POS
  beendet die Sitzung meist früher. Eine längere Schicht verlangt eine neue PIN-Eingabe.
- **Restannahme:** Wer das Gerät und dessen Geräte-Schlüssel vollständig kontrolliert, bleibt
  außerhalb, wie im Issue festgehalten.
