---
type: ADR
title: POS-Auto-Logout — abgeleiteter Freeze statt gebuchter Holds
description: Der Inaktivitäts-Logout am Terminal leitet seinen Einfrier-Zustand pro Takt aus MatDialog und Verbindungsstatus ab, statt Holds zu buchen; Frist und Flag kommen aus Location und Mitarbeiter.
tags: [pos-client, users, locations, auth]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-03T00:00:00.000Z }
---

## Problem

Der POS meldete sich nie automatisch ab. `user.autoLogOff` und
`location.settings.genericUserSettings.autoLogOffTime` existierten seit Langem
als Datenfelder — inklusive Checkbox in der Cloud-Benutzerverwaltung, Sync bis
in die Edge-SQLite und DB-Spalte —, hatten im POS-Client aber keinen einzigen
Leser. Es gab weder Aktivitätserfassung noch Timer.

Beim Nachrüsten stellten sich drei Fragen: Wo lebt der Dienst, ohne einen
Bibliotheks-Zyklus zu erzeugen? Woher weiß er, dass gerade eine Bestellung
aufgenommen wird? Und wie verhindert man, dass der erste Release alle Kassen
nach 30 Sekunden abmeldet?

## Entscheidung

**1. Der Dienst lebt in der Shell-Lib.** `AppPosShellComponent` umschließt
genau die authentifizierten Routen (`/setup` und `/login` liegen außerhalb) und
steht oben im POS-Abhängigkeitsgraph — sie darf `LocationService`, `MatDialog`
und den Bestelldialog gleichzeitig kennen. `libs/domains/auth/data-access`
schied aus: die Lib wird vom Admin-Client mitkonsumiert, POS-Sitzungssemantik
gehört dort nicht hinein.

**2. Der Freeze wird abgeleitet, nicht gebucht.** Pro Takt wird geprüft, ob ein
`OrderDialogComponent` in `MatDialog.openDialogs` steht bzw. die Verbindung
fehlt. Die Alternative — eine `acquireHold()`-API, die der Bestelldialog beim
Öffnen nimmt und beim Zerstören freigibt — wurde verworfen: ein Hold, der wegen
einer Exception oder eines unerwarteten Lebenszyklus nicht freigegeben wird,
schaltet den Auto-Logoff **dauerhaft und unsichtbar** ab. Bei einem
sicherheitsnahen Feature schlägt ein selbstheilender Zustand die
Buchführung. Nebeneffekt: der Bestelldialog und seine drei Aufrufstellen
bleiben unangetastet, und es entsteht kein Zyklus
`shell → dashboard → order-dialog → shell`.

**3. Eingefroren verbraucht kein Budget.** Beim Auftauen läuft die volle Frist
neu. Ein 200-ms-Netzwackler während der Vorwarnung darf den Kassierer nicht im
nächsten Moment ausloggen.

**4. Wall-clock statt Zähler.** Der Takt rechnet `now − lastActivityAt` statt
einen Zähler zu dekrementieren. Damit übersteht die Frist die
Timer-Drosselung im Hintergrund verlustfrei: der erste Takt nach dem
Zurückkommen sieht die echte Zeit und meldet ab. Ein Hintergrund-Fenster gilt
bewusst nicht als Anwesenheit — der POS ist eine Kiosk-Anwendung.

**5. Aktivität schreibt kein Signal.** Die DOM-Listener setzen ein Plain-Feld;
einziger Signal-Schreiber ist der 1-Hz-Takt. Damit braucht es kein Throttling
und es entsteht keine Change Detection pro Tastendruck (der POS läuft
zoneless). Die Listener hängen in der **Capture-Phase** am `document`, weil der
Bestelldialog `stopPropagation()` ruft. Bewegungs-Events sind ausgeschlossen:
ein aufliegender Finger auf dem Sunmi-Panel hielte die Sitzung sonst dauerhaft
offen.

**6. Das Flag reist in `pos_current_user`.** Nicht über `UserService.users()` —
die Nutzerliste lädt mit einem `$select` ohne das Feld (Schutz der
`employeeNumber`) und existiert offline gar nicht. `verifyPin` liefert den
vollen Datensatz, also ohne Zusatz-Roundtrip. `autoLogOff` bleibt bewusst
außerhalb von `userQueryProperties`: sonst wäre `GET /users?autoLogOff=false`
eine Enumeration ohne fachlichen Gegenwert.

**7. Untergrenze 60 s, Default 2 min.** Der alte Schema-Default von 30 Sekunden
war nie wirksam und ist für eine Kasse unbrauchbar. Der Schema-Default steigt
auf 2 Minuten, die Untergrenze fängt Bestandsfilialen ab, und Migration 007 in
`panary-cloud` korrigiert die Daten. Ohne Feature-Flag — abgestimmt, weil
`panary-core` keinen Staging-Kanal hat und die Datenkorrektur das Risiko
bereits abräumt.

## Konsequenzen

- `PosSessionService` ist ab jetzt der einzige POS-Logout-Pfad. Button,
  Ausstempeln und Inaktivität teilen Offline-Sperre, Doppel-Logout-Guard und
  `MatDialog.closeAll()`.
- `AuthService.logout()` räumt `pos_current_user` mit weg. Das behebt einen
  Bestandsbug: weil `posAuthGuard` ausschließlich daran entscheidet, blieb nach
  einem Token-Ablauf jede geschützte Route erreichbar — ohne gültiges
  Geräte-JWT, also mit leerem Bildschirm statt Login-Aufforderung.
- Die Freeze-Liste ist eine Konstante im Idle-Service. Weitere
  freeze-würdige Dialoge werden dort ergänzt, nicht beim Aufrufer.
- Während der Pause (`startBreakAt`) wird **nicht** eingefroren. Bewusste
  Abweichung von „No logout to allow easy resume", das den Logout nur beim
  Pausenstart verhindert.
- Release-Reihenfolge ist bindend: Core-Release → Cloud-Pin-Bump →
  Cloud-Release mit Migration 007 → erst dann `pos-v*`. Andere Reihenfolge
  bedeutet 60-Sekunden-Logouts auf Bestandsfilialen.

Details zur Wirkkette: [POS-Auto-Logout bei Inaktivität](../domains/pos-auto-logout.md).
