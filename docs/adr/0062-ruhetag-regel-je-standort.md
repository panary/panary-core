---
type: ADR
title: 'ADR 0062 — Ruhetag-Regel je Standort: Manager-Freigabe oder Sperre mit Inhaber-Ausweg'
description: 'An einem laut Öffnungszeiten geschlossenen Tag eröffnet die Edge keinen Geschäftstag automatisch und nimmt Bestellung, Kassieren und Tageseröffnung nur mit PIN-Freigabe an — nach der Standort-Einstellung closedDayPolicy (manager-approval | block).'
tags: [businessdays, locations, orders, pos-client, opening-hours]
status: stable
decision: accepted
generated: { by: claude-code/opus-5.5, at: 2026-10-27T00:45:00Z }
sources:
  - { id: issue-1133, resource: 'https://github.com/panary/panary-core/issues/1133', title: 'Ruhetag laut Öffnungszeiten an der Edge durchsetzen' }
  - { id: issue-1132, resource: 'https://github.com/panary/panary-core/issues/1132', title: 'Startseite zeigt 8–24 Uhr am Ruhetag' }
  - { id: cloud-1471, resource: 'https://github.com/panary/panary-cloud/issues/1471', title: 'Cloud-Hälfte der Ruhetag-Regel' }
---

# ADR 0062 — Ruhetag-Regel je Standort: Manager-Freigabe oder Sperre mit Inhaber-Ausweg

## Problem

Die Testfiliale nahm am Montag, 2026-10-26, Bestellungen an, obwohl der Montag in der Cloud als
geschlossen gepflegt war. Im Order-Pfad prüfte nichts die Öffnungszeiten: Das Order-Gate kannte nur
`BUSINESS_DAY_NOT_SET` und die Altersgrenze (cloud-ADR 0047), der Kassen-Guard nur Kasse und
Betriebsart. Die Auto-Rotation (Boot, 4-Uhr-Worker, Lazy-Rotation im Order-Hook) eröffnete im
Standalone- bzw. Override-Betrieb auch am Ruhetag einen neuen Tag. Geschützt waren nur
Vorbestellungen (`validate-opening-hours.hook.ts`, core#286).

Eine harte Sperre allein trägt nicht: Eine gesetzliche Pflicht dazu ist nicht bekannt
(Ladenöffnung und Sperrzeit sind Landesrecht), und KassenSichV/GoBD verlangen, dass jeder
Verkauf mit TSE aufgezeichnet wird, auch am Ruhetag. Eine Kasse, die offline gar nicht mehr
öffnet, treibt Verkäufe an der Kasse vorbei.

## Entscheidung

**Standort-Einstellung `openingHoursSettings.closedDayPolicy`**, kein Feature-Flag (Michael,
2026-10-27):

- `manager-approval` (Vorgabe, auch wenn das Feld fehlt): Verkauf am Ruhetag nur nach Freigabe
  per PIN eines Kontos mit Rolle `tenant:manager` oder `tenant:owner`.
- `block`: Die Manager-PIN reicht nicht. Regulär öffnet nur eine Ausnahme „heute geöffnet“ aus
  der Cloud; als Ausweg bleibt die PIN des Inhabers (`tenant:owner`).
- Gepflegt nur in der Cloud, die Edge übernimmt den Wert per Pull. Kein Schema-Default, damit
  Bestandsstandorte keine Migration brauchen; den Default löst `resolveClosedDayPolicy` auf.
- Gilt in beiden Betriebsarten (`pos-cashier` und `orders-only`). Vorbestellungen, die am
  Ruhetag erfasst und an einem offenen Tag abgeholt werden, bleiben unberührt.

**Ruhetag-Urteil** in `@panary/locations/domain` (`closedDayStatus`, `isClosedOn`), damit Edge und
Cloud am selben Kalendertag dasselbe sagen: Kalendertag in Filialzeit, Ausnahme vor Wochentag,
`enabled: false` und ein **fehlender** Wochentag in `regular` ergeben `unknown`, nie
`closed`. Das weicht bewusst von `getOpeningHoursForDate` ab, das einen fehlenden Wochentag als
geschlossen liest: Für ein Gate vor dem Verkauf wäre das eine Sperre für Filialen, die nie
„geschlossen“ gepflegt haben.

**Edge:**

- Keine Auto-Rotation am Ruhetag (Boot, Worker, Lazy-Rotation), Log
  `business_day.rotation_skipped_closed_day`. Der Vortag bleibt offen, bis freigegeben wird oder
  die Altersgrenze greift.
- Order-Anlage, Kassieren (Patch auf `completed`) und `openDay` von außen verlangen am Ruhetag
  eine heute gültige Freigabe am laufenden Geschäftstag, sonst 400 `LOCATION_CLOSED_TODAY`
  (`BD_6010`) mit `date` und `policy`. Die Freigabe wird **vor** der Altersgrenze geprüft, weil
  sie im Standalone-Betrieb einen frischen Tag eröffnet.
- `businessdays.approveClosedDay` prüft die PIN serverseitig (mit dem Aufrufer als `user`, also
  mandantengebunden, core#332), dann die Rolle nach der Regel (`BD_6011`/`BD_6012`). Darf lokal
  rotiert werden und ist ein Tageswechsel fällig, eröffnet sie den Tag; sonst stempelt sie den
  laufenden. Stempel: flache Felder `openedOnClosedDayBy|Role|At|Date` am Geschäftstag, extern
  nicht schreibbar (Patch-Resolver). Die Freigabe gilt für den ganzen Kalendertag; unter
  `block` zählt nur ein Stempel mit `tenant:owner`.
- `businessdays.getClosedDayStatus` beantwortet dem POS vorab, ob eine Freigabe fehlt. Sie
  entscheidet nichts.
- Fail-open: Sind die Ausnahmen nicht lesbar, wird nicht gesperrt
  (`business_day.closed_day_check_skipped`).

**POS:** Vor dem Anlegen fragt die Kasse `getClosedDayStatus` und zeigt den Freigabe-Dialog, solange
der Warenkorb steht. Kassieren und „Tag eröffnen“ reagieren auf `BD_6010`.

**Nachvollziehbarkeit:** Geschäftstage reisen nur Cloud→Edge (`SyncableMasterDataService`). Der
Stempel bleibt deshalb lokal; in der Cloud kommt die Freigabe als Audit-Event an
(`metadata.reason: closed-day-approved`), das Edge→Cloud gepusht wird. Setzt die Cloud den
Stempel selbst (cloud#1471), reist er per Pull zur Edge — dafür legt die Migration die Spalten an.

## Konsequenzen

- Bestandsdaten: Filialen mit gepflegten Ruhetagen verlangen ab dem Rollout eine Freigabe. Lange
  nicht gesyncte Edges urteilen nach ihrem alten Wochenplan.
- Am Ruhetag läuft ein Vortag ohne Freigabe bis zur Altersgrenze (26 h) weiter, nimmt aber
  nichts mehr an. Die Freigabe ist der vorgesehene Ausweg, in beiden Regeln.
- Gepairt (Cloud verwaltet den Lifecycle) stempelt die Freigabe nur den laufenden Tag; ohne Tag
  eröffnet die Cloud, die Edge meldet `BUSINESS_DAY_NOT_SET`.
- Release in zwei Richtungen: Die Edge muss `closedDayPolicy` und die Stempel-Spalten kennen,
  bevor die Cloud sie setzt (core-Release vor cloud#1471). Die Domain-Helfer erreichen die Cloud
  erst mit dem Lib-Publish.
- Der Socket-Client des POS registrierte für `businessdays` nur `open`/`close`, die die Edge nicht
  kennt. Mit dieser Änderung sind `openDay`/`closeDay`/`refreshClosingStatus` und die beiden
  neuen Methoden registriert.
