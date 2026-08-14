---
type: ADR
title: Promo-Codes am POS strikt online — keine Offline-Annahme
description: Rabattcodes werden am Edge nicht gespiegelt; der POS reicht Prüfung und Einlösung im Moment der Eingabe an die Cloud durch und lehnt ohne Verbindung ab.
tags: [discounts, pos, sync, edge]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-14T09:45:00Z }
---

# Promo-Codes am POS strikt online

## Problem

Ein Kassierer soll am POS einen Rabattcode einlösen können. Zwei Eigenschaften des
Systems stehen dem im Weg:

1. **Codes sind Cloud-only.** `discount-codes` und der append-only Einlöse-Log
   `discount-code-redemptions` werden nicht an den Edge gesynct. Die Begründung steht
   im Schema-Kommentar von `discount-code.schema.ts`: Ein am Edge mitgeführter
   `usageCount` erzeugt bei mehreren Kassen und periodischem Sync Lost Updates — zwei
   Kassen lösen denselben Code mit `usageLimit: 1` ein, beide sehen lokal „1 von 1",
   und der Sync entscheidet hinterher, welche Zeile gewinnt. Das Limit wäre eine
   Empfehlung, keine Grenze.
2. **Der POS spricht ausschließlich den Edge.** Er hat keine eigene Cloud-Verbindung
   und kennt die Cloud-Adresse nicht.

Damit fehlt eine Brücke, und mit ihr die Frage, was bei fehlender Cloud-Verbindung
passieren soll. Diese Frage ist keine Implementierungsdetail-Frage: Sie entscheidet,
ob das Limit eine harte Grenze bleibt.

## Entscheidung

**Rabattcodes am POS sind strikt online.**

- Der Edge betreibt einen Proxy (`apps/api-edge/src/services/discount-code-redeem/`),
  der Prüfung (`find`) und Einlösung (`create`) im Moment der Eingabe an die Cloud
  durchreicht. Er spiegelt keine Codes und führt keinen Zähler.
- Ist die Cloud nicht erreichbar oder besteht kein aktives Pairing, lehnt der POS die
  Code-Eingabe mit einem klaren Hinweis ab. Die Bestellung läuft ohne Code weiter;
  manuelle Rabatte aus dem gesyncten Katalog bleiben unberührt verfügbar.
- Erreichbarkeit wird **am Aufruf selbst** gemessen (echter Request mit 5 s Timeout),
  nicht am Sync-Zeitstempel. „Zuletzt erfolgreich gesynct" ist eine Aussage über
  Datenaktualität, nicht darüber, ob die Cloud in dieser Sekunde antwortet.
- Die Cloud-Seite ist ein eigener Edge-Scope-Endpunkt (`discount-code-redeem`,
  panary/panary-cloud#271), nicht der Einlöse-Log selbst. Dessen `find` gäbe jedem
  Edge sämtliche Einlösungen seines Tenants.

### Verworfene Alternative: optimistische Annahme mit Reconciliation

Der POS akzeptiert den Code offline und gleicht später ab. Verworfen, weil sie beim
Durchrechnen gar nicht erst umsetzbar ist: Der Edge kennt den Code nicht — weder ob er
existiert, noch welchen Rabatt er gewährt, noch ob sein Limit erreicht ist. „Optimistisch
annehmen" hieße hier, den Kassierer den Rabattwert selbst eintippen zu lassen. Das ist
ein manueller Rabatt mit einem Code daneben, keine Code-Einlösung.

Die Variante ließe sich nur retten, indem man Codes doch an den Edge syncte — also genau
die Entscheidung kippte, die das Lost-Update-Problem vermeidet. Sie ist damit keine
Alternative zur Offline-Frage, sondern eine Alternative zur Cloud-only-Entscheidung.

## Konsequenzen

- **Bei Cloud-Ausfall kann kein Code eingelöst werden.** Das ist der bewusst gewählte
  Preis. Der Kassierer sieht den Grund und kann einen manuellen Rabatt gewähren; die
  Kasse bleibt in jedem Fall bedienbar (Bestellung, Zahlung, Bon).
- **Ein Code kostet einen Cloud-Roundtrip.** Bei 5 s Timeout ist der schlechteste Fall
  eine spürbare, aber begrenzte Wartezeit an der Kasse. Die Prüfung läuft beim Eintippen,
  die Einlösung beim Abschluss — beides außerhalb des kritischen Bon-Drucks.
- **Das Limit bleibt hart.** Die einzige Instanz, die zählt, ist der append-only-Log in
  der Cloud; nebenläufige Kassen laufen gegen denselben Zähler.
- **Zwei Ablehnungsklassen, die der POS unterscheiden muss:** fachlich (`expired`,
  `limit_reached`, `not_found` …) und technisch (`not_paired`, `cloud_unreachable`).
  Nur die zweite darf als „später nochmal versuchen" gelesen werden.
- **Standalone-Betrieb ohne Pairing kennt keine Codes.** Das ist konsistent: Ohne Cloud
  gibt es auch keine Code-Verwaltung.
- Angewandte Codes landen als `appliedDiscounts`-Eintrag mit `method: 'code'` in der
  Bestellung; die kanonische Engine füllt `computedAmountCents`. Siehe
  [Rabatte](../domains/rabatte.md).
- **Die Order-ID wird vorab vergeben.** Aus „erst einlösen, dann bestellen" folgt, dass
  die Einlösung eine Bestellung referenzieren muss, die es noch nicht gibt. Der POS
  erzeugt die `_id` deshalb selbst (uuidv7) und reicht sie an beide Aufrufe; der
  Edge-Resolver akzeptiert eine mitgegebene `_id` ohnehin (Offline-First-Pfad).
  Verbleibendes Restrisiko: Scheitert das Anlegen der Bestellung nach erfolgreicher
  Einlösung, verweist die Einlösung ins Leere. Das ist auffindbar; die zunächst
  ausgelieferte Variante (`orderId: null`) war es nicht. Der umgekehrte Weg — erst
  bestellen, dann einlösen — wurde verworfen: Dort bekäme der Gast bei einem
  aufgebrauchten Code den Rabatt ungezählt, und eine nachträgliche Korrektur träfe
  eine bereits TSE-signierte, ggf. gedruckte Bestellung.
