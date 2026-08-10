---
type: Guide
title: Zugewiesene POS-Geräte — manuelle Verifikation vor dem Rollout
description: Acht Prüfschritte am laufenden Terminal, inklusive Umgehungsprobe in den DevTools und der drei Notfallpfade, die eine kaputte Zuweisung unwiderruflich sperren würde.
tags: [devices, users, security, pos]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-10T22:40:00.000Z }
---

Die Geräte-Zuweisung (PNRY-FEAT-DEVICE-ASSIGNMENT-001) ist **fail-closed**: Was hier nicht
funktioniert, sperrt im Zweifel ein Terminal aus. Diese Liste ist deshalb vor dem ersten
produktiven `assigned`-Gerät abzuarbeiten, nicht danach.

Hintergrund: [ADR 0023](../adr/0023-zugewiesene-pos-geraete.md),
[Domain-Konzept](../domains/pos-geraete-zuweisung.md).

> **Reihenfolge beim Ausrollen: Server vor Client, immer.** `additionalProperties: false`
> bedeutet, dass ein alter Server einem neuen Client mit 400 antwortet; umgekehrt ist es
> harmlos. `core` hat keinen Staging-Kanal — ein `v*`-Tag rollt binnen einer Stunde auf alle
> Kunden aus.

## Vorbereitung

Ein Edge mit mindestens zwei gepairten POS-Geräten, drei POS-Benutzern (davon einer mit der
Rolle Inhaber/Filialleiter/Techniker) und bekannten PINs.

## 1. Bestandsgerät bleibt unverändert

Nach dem Update, **ohne** irgendeine Zuweisung zu setzen: Login-Screen zeigt alle POS-Benutzer,
das Personalnummer-Stempel-Panel ist da. Das ist die Abwärtskompatibilitäts-Garantie
(`NULL → shared`); schlägt sie fehl, ist alles Weitere hinfällig.

## 2. Ein zugewiesener Mitarbeiter

Im Edge-Admin → Geräte → Zeilen-Aktion „Zuweisung" → einen Mitarbeiter wählen, speichern.
Am Terminal neu laden:

- Der Screen springt **direkt** in die PIN-Eingabe, kein Zwischenschritt.
- **Kein Zurück-Pfeil** links oben.
- Rechte Panel-Hälfte zeigt „Dieses Gerät gehört zu …" mit dem Namen.
- Das Stempel-Panel ist **weg** — auf Desktop und in der mobilen Ansicht.

## 3. Drei zugewiesene Mitarbeiter

Zuweisung auf drei erweitern. Der Screen zeigt eine **kompakte Zeilenliste** (kein
Kachelraster), mit Zurück-Pfeil in der PIN-Eingabe.

## 4. Umgehungsprobe (DevTools am zugewiesenen Gerät)

Der wichtigste Schritt: Er prüft, ob die Zuweisung eine Sicherheitsgrenze ist oder nur
Bildschirm-Kosmetik. In der Konsole des POS-Clients:

```js
// Nur Zugewiesene + Freigabe-Rollen — NICHT die volle Belegschaft
await usersService.find({ query: { $limit: 250 } })

// Fremder Mitarbeiter: dieselbe Meldung wie ein falscher PIN
await usersService.verifyPin({ userId: '<fremde-id>', pin: '1234' }) // → 'PIN ungueltig'

// get-by-id ist kein Umweg
await usersService.get('<fremde-id>') // → NotFound/Forbidden

// Das Gerät kann sich nicht selbst befreien
await devicesService.patch('<eigener-record>', { deviceAccessMode: 'shared' }) // → Forbidden
```

Erscheint hier **irgendein** fremder Mitarbeiter, ist der Edge nicht auf dem Stand von
Schritt 2 des Features — dann sofort abbrechen und die Version prüfen.

## 5. Notfallpfade — der teuerste Fehler

Alle drei **am zugewiesenen Gerät**, mit der PIN eines Inhabers/Filialleiters:

1. **Storno** eines Postens mit Manager-Freigabe.
2. **Kassenabschluss-Freigabe**.
3. **Entkoppeln** (POS-Einstellungen → Gefahrenbereich).

Der dritte ist der kritische: Schlägt er fehl, ist das Gerät unwiderruflich an den Mandanten
gebunden und lässt sich nur noch über die Datenbank lösen.

## 6. Realtime

Login-Screen offen lassen, im Admin die Zuweisung ändern. Der Screen zieht **ohne Neustart**
nach. Gegenprobe: Ein *anderes* Gerät patchen darf an diesem Terminal nichts ändern — das
`devices`-Publish ist mandantenweit, nur der Filter auf die eigene `deviceId` trennt.

## 7. Archivierter Mitarbeiter

Den einzigen zugewiesenen Mitarbeiter archivieren, Terminal neu laden → Zustand
`assignment-error` mit Hinweistext. **Kein** Rückfall auf die volle Benutzerliste. Danach die
Zuweisung im Admin korrigieren.

## 8. Zurück auf geteilt

Gerät auf „Geteilt" stellen → Verhalten exakt wie in Schritt 1, Stempel-Panel wieder da.

---

## Was diese Liste bewusst nicht prüft

- **Zeiterfassung ohne Identitätsnachweis.** `users.checkin` prüft die Personalnummer
  serverseitig nicht. Das ausgeblendete Panel ist UI-Kosmetik, kein Schutz.
- **Aktionen nach dem Login.** `verifyPin` stellt kein Token aus; `order.userId` ist
  client-behauptet. Die Zuweisung schützt den Login, nicht die Aktionen.
- **Offboarding.** Wird ein Mitarbeiter *nachträglich* archiviert, bleibt die Zuweisung stehen
  (Schritt 7 zeigt genau diesen Zustand). Beim Zuweisen wird der Status geprüft, danach nicht.

Alle drei sind eigene Tickets, siehe [ADR 0023](../adr/0023-zugewiesene-pos-geraete.md).
