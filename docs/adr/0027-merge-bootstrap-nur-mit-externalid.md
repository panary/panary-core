---
type: ADR
title: Merge-Bootstrap nur für Entitäten mit externalId
description: Der Bootstrap-Modus merge-by-external-id verarbeitet ausschließlich Services, deren Domain-Schema ein externalId-Feld führt — als Allowlist statt Ausschlussliste.
tags: [sync, cloud-connection, users]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-12T13:00:00Z }
---

# Merge-Bootstrap nur für Entitäten mit `externalId`

## Problem

Der Bootstrap-Modus `merge-by-external-id` gleicht Edge- und Cloud-Bestand ab, indem er
Records über `record.externalId` paart. Findet er zu einem Edge-Record keine `externalId`,
legt er einen `sync-conflict` mit Grund `external-id-missing` an, den ein Operator im
Admin-Panel auflösen muss.

Die Liste der verarbeiteten Services war als **Ausschlussliste** formuliert: alle
Master-Data-Services minus `locations`, `businessdays` und `opening-hour-exceptions`. Damit
standen `users`, `customers` und `corporate-customers` darin — obwohl keines dieser
Domain-Schemas ein `externalId`-Feld kennt und nie eines hatte. Von den fünf gelisteten
Services trugen nur zwei (`products`, `product-groups`) das Feld.

Für die drei anderen greift damit ausnahmslos der Konflikt-Zweig. Konkrete Folgen:

- Ein frisch aufgesetzter Edge hat mindestens den initialen Admin, den das Setup anlegt.
  Der Merge-Modus erzeugte für ihn **garantiert** einen Konflikt — unabhängig vom
  Cloud-Stand, bei jedem Kunden, bei jedem Pairing.
- Dieser Konflikt ist **unauflösbar**. `tenant:owner` steht auf der Push-Blockliste
  (`isSyncPushBlockedRole`), wird also nie zur Cloud gepusht. Es kann per Design kein
  Cloud-Pendant entstehen, zwischen dem der Operator wählen könnte. Von den drei angebotenen
  Auflösungen ist `use-cloud` gegenstandslos, `use-edge` folgenlos und `discard` löscht das
  Owner-Konto.
- Beobachtet am Testserver 2026-08-12 (panary/panary-core#183, #184).

Dieselbe Begründung hatte `locations` und `businessdays` bereits vorher aus dem Merge-Pfad
genommen — der Kommentar im Code nannte sie ausdrücklich („würde für jeden Edge-Standort
einen `sync-conflict` mit Grund `external-id-missing` erzeugen"). Sie galt für die drei
übrigen unverändert, nur hatte sie dort niemand angewandt.

## Entscheidung

**Die Liste wird eine Allowlist.** `MERGE_BY_EXTERNAL_ID_SERVICES` zählt die Services
explizit auf, die `externalId` in ihrem Data-Schema führen — aktuell `product-groups` und
`products`. Sie lebt in einem eigenen Modul (`apps/api-edge/src/workers/merge-services.ts`);
eine Invarianten-Spec bindet Liste und Schemas aneinander.

Verworfen wurden zwei Alternativen:

- **E-Mail/`loginname` als zweites Match-Kriterium für `users`.** Löst zwar den fachlichen
  Fall („dieselbe Person existiert auf beiden Seiten"), aber E-Mail ist am Edge nicht
  garantiert eindeutig, und ein Fehlmatch verschmilzt zwei Personen samt Rollen und
  `permissions`. Der Preis eines Fehlers steht in keinem Verhältnis zum Gewinn.
- **`externalId` auf den drei Schemas nachrüsten.** Ohne Befüllung wirkungslos: Ein am Edge
  lokal angelegter User bekommt nie eine. Sinnvoll erst, wenn Personal- oder Kundendaten
  tatsächlich aus einem Fremdsystem importiert werden — dann als eigene Entscheidung.

**Verwaiste Edge-Konten werden gemeldet, nicht angefasst.** Der Konsistenz-Check des
Bootstrap-Reports weist lokale User mit push-blockierter Rolle als `WARN` samt Loginnamen
aus. Kein automatischer Eingriff: An einem `tenant:owner`-Konto entscheidet der Betreiber,
und es kann der einzige Zugang zum Edge-Panel sein, wenn der Cloud-Tenant unter einer
anderen Identität angelegt wurde. `isHealthy` bleibt unberührt.

## Konsequenzen

- Der Merge-Modus erzeugt nur noch Konflikte, die auch auflösbar sind.
- Ein neu hinzukommender Master-Data-Service wird vom Merge **ignoriert**, statt
  stillschweigend Konflikte zu produzieren. Wer ihn aufnehmen will, muss `externalId`
  deklarieren — die Invarianten-Spec erzwingt das.
- Records der nicht gelisteten Services verlieren nichts: Sie laufen unverändert über den
  nachgelagerten `runBootstrapEdgeToCloud`-Push.
- Der Edge behält nach einem Merge-Bootstrap ggf. ein zweites Owner-Konto. Das ist gewollt
  und im Report sichtbar; die Bereinigung ist eine Betreiber-Entscheidung.
- **Offen:** Personal auf beiden Seiten bleibt unverbunden. Wenn Edge und Cloud denselben
  Menschen führen, entstehen zwei Datensätze ohne Beziehung. Das ist der Preis dieser
  Entscheidung und wird erst durch einen echten Identitäts-Abgleich gelöst.
- **Nicht behoben, hier nur festgehalten:** `reconcileStaleUsers` setzt jeden lokalen User
  auf `ARCHIVED`, der nicht im Cloud-Visibility-Snapshot steht — ohne Ausnahme für
  `tenant:owner` oder den angemeldeten Nutzer. Am Edge ist das derzeit folgenlos, weil
  `ARCHIVED` dort weder Login noch Listen filtert. Beides zusammen ist eine Falle: Wer den
  fehlenden Filter nachrüstet, sperrt damit unbeabsichtigt verwaiste Owner-Konten aus.

Siehe auch: [Cloud-Pairing-Wizard](../architecture/cloud-pairing-wizard.md).
