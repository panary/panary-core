---
type: ADR
title: Fiskal-Snapshot des Geschäftstags wird serverseitig abgeleitet
description: Der `operationMode` eines Geschäftstags wird im Create-Resolver aus der Location abgeleitet und der Wert aus der Anfrage verworfen, weil dieser Snapshot das Fiskal-Gate ist und ihn sonst ein Kassen-Token selbst bestimmt.
tags: [businessdays, tse, locations, sync, fiskalisierung]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-11T12:18:26.000Z }
---

## Problem

`businessDay.operationMode` ist der Schnappschuss der Betriebsart, den die Tageseröffnung
einfriert. Er entscheidet drei Dinge: ob die Bestellungen des Tages TSE-signiert werden
([`sign-order-tse.hook.ts`](../../apps/api-edge/src/hooks/sign-order-tse.hook.ts) über den
geteilten Helfer `requiresFiscalSignature`), ob ohne offene Kasse überhaupt bestellt werden
darf ([`restrict-order-to-cash-session.ts`](../../apps/api-edge/src/hooks/restrict-order-to-cash-session.ts)),
und ob der Tagesabschluss Cash-Count und Z-Bon verlangt. Er ist damit das Fiskal-Gate —
siehe [ADR 0005, Punkt 3](0005-fiskalisierung-architektur.md).

Er stand im Create-Schema und wurde vom Resolver nur als **Default** behandelt: Ein Wert aus
der Payload gewann, abgeleitet wurde nur, wenn keiner kam. Die sorgfältige Ableitung aus der
Location saß in der Custom-Method `openDay`. Wer statt `openDay` direkt `create` aufrief,
bestimmte selbst, ob sein Geschäftstag fiskalisiert wird — und `create` steht in
`businessDaysMethods`, `DEVICE_POS` hat `MANAGE` auf `BUSINESS_DAYS`. Ein Kassen-Token
genügte.

Die eigentliche Ursache waren **zwei Ableitungen derselben Sache**: die starke in der
Custom-Method, die schwache im Resolver. Ungeschützt war der Pfad mit weniger Aufmerksamkeit.

Im Normalbetrieb war die Lücke verstellt — bei gepairtem Edge quittiert der
`cloudManagedHook` ein direktes `create` mit `403`. Das ist aber eine Nebenwirkung: Der Guard
klärt die Lifecycle-Hoheit zwischen Edge und Cloud, ist bei gestörtem
`cloud-connection`-Lookup bewusst fail-open und erreicht den Standalone-Edge nie.

## Entscheidung

1. **Der Create-Resolver leitet ab, die Anfrage wird verworfen.**
   `businessDayDataResolver.operationMode` liest `location.operationMode` und ignoriert, was
   in `data` steht — kein Default, sondern eine Überschreibung
   ([Edge](../../apps/api-edge/src/services/business-days/business-days.schema.ts),
   Cloud: `apps/api-cloud/src/services/businessdays/businessdays.schema.ts`).
2. **Genau eine Ableitung.** `openDay` leitet den Modus nicht mehr selbst ab, sondern
   verlässt sich auf den Resolver.
3. **fail-safe Richtung `pos-cashier`.** Fehlt die `locationId` oder ist die Location nicht
   ladbar, wird signiert statt nicht signiert: Zu viel Fiskalisierung ist ein Aufwands-, zu
   wenig ein Rechtsproblem (KassenSichV §146a). Gleiche Richtung wie das Order-Gate in
   `fiscal-gate.ts`.
4. **Unveränderlich nach Eröffnung.** Der Patch-Resolver setzt `operationMode` auf
   `undefined` — ein laufender Tag lässt sich nicht umwidmen.
5. **Sync-Applies sind ausgenommen**, in beiden Topologien, aber technisch verschieden:
   - **Cloud:** expliziter Zweig `if (context.params.fromSync) return value`.
   - **Edge:** implizit — `syncAwareResolveCreate` überspringt bei `fromSync` den *gesamten*
     Create-Resolver, weil dort der vollständige Lifecycle-Record der Cloud ankommt
     (auch bereits geschlossene Tage).

   Begründung in beiden Fällen dieselbe: Ein gepullter Tag trägt seinen Snapshot legitim.
   Ihn lokal aus der *aktuellen* Betriebsart zu überschreiben schriebe Historie um — ein um
   06:00 als `pos-cashier` eröffneter Tag würde still zu `orders-only`, wenn die Betriebsart
   um 10:00 umgestellt wird und der Edge um 10:05 pusht.
6. **Das Feld bleibt im Create-Schema** (`businessDayDataSchema`), obwohl der Request-Pfad es
   verwirft — der Sync-Apply transportiert es und braucht es. Der Zwang gehört deshalb in den
   Resolver, nicht in die Validierung.

### Verworfene Alternative: den `cloudManagedHook` härten

Naheliegend war, den Payload-Wert als Default zu belassen und stattdessen den Guard zu
schärfen, der `create` bei gepairtem Edge ohnehin blockt. Verworfen aus drei Gründen: Der
Guard ist bewusst fail-open (ein gestörter `cloud-connection`-Lookup lässt durch), er greift
beim Standalone-Edge nie, und er beantwortet eine andere Frage — *wer besitzt den Lifecycle*,
nicht *welcher Modus gilt*. Ein Schutz, der von der Nebenwirkung eines fremden Guards
abhängt, ist keiner.

## Konsequenzen

- **Jeder neue `create`-Pfad auf `businessdays` erbt den Zwang, ohne ihn zu kennen** — der
  Resolver ist der Engpass. Wer ihn umgeht (roher Adapter-Zugriff, eigener Service, ein
  zweiter Ort mit eigener Ableitung), verliert ihn ohne Warnung. Genau diese Konstellation
  hat den Befund erzeugt.
- **Wer `syncAwareResolveCreate` am Edge umbaut oder entfernt, muss die `fromSync`-Ausnahme
  im Resolver nachziehen.** Die Kopplung ist heute nur eine Weiche eine Ebene höher; die
  Weiche ist deshalb exportiert und getestet, statt im Kommentar behauptet.
- **Eine Betriebsart-Umstellung wirkt erst am nächsten Geschäftstag.** Das ist die
  Snapshot-Semantik, kein Verzug, den man „beheben" sollte — und der Grund, warum der
  Fiskal-Trigger in ADR 0005 der Geschäftstag ist und nicht die Location.
- **Ein nicht ladbarer Location-Datensatz erzeugt einen `pos-cashier`-Tag**, auch wenn die
  Filiale `orders-only` fährt. Sichtbar über das Log-Event
  `business_day.operation_mode_fallback` — nicht stillschweigend.
- **Korrektur eines falsch eröffneten Tages** geht nur über Schließen und Neu-Eröffnen, nicht
  über einen Patch.

## Status

Entschieden und umgesetzt: Cloud panary/panary-cloud#146, Edge panary/panary-core#157
(2026-08-11). Als ADR nachgetragen mit panary/panary-core#166 — die Regel gilt in **beiden**
Repos; der geteilte Helfer und beide Signier-Pfade hängen hier, panary-cloud verweist hierher
statt einen Zwillings-ADR zu führen.
