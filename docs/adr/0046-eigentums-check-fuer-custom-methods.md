---
type: ADR
title: 'Ein geteilter Eigentums-Check für Custom Methods statt vier Handschriften'
description: 'ADR zur Zusammenführung der Mandanten-Eigentumsprüfung in @panary/shared-backend, nachdem dieselbe Lücke zum vierten Mal auftrat — mit fail-closed als Default und einer benannten Ausnahme für den Geräte-User vor dem Pairing.'
tags: [security, users, pre-orders, businessdays, multi-tenancy]
status: stable
decision: accepted
implementation: 'umgesetzt 2026-09-22 (#357, Edge); Cloud-Zwilling offen'
generated: { by: claude-code/opus-5, at: 2026-09-22T13:00:00Z }
---

# Ein geteilter Eigentums-Check für Custom Methods

Dieselbe Lücke ist in diesem Repo viermal aufgetreten. Dreimal wurde sie einzeln
geschlossen, beim vierten Mal fiel auf, dass es drei verschiedene Fassungen
derselben vier Zeilen gab. Dieses ADR hält fest, warum sie jetzt eine sind —
und warum das die Entscheidung von [#189](https://github.com/panary/panary-core/issues/189)
bewusst umkehrt.

Vorgeschichte: [Zeiterfassung](../security/zeiterfassung-aufrufer-scope.md) (#189),
[PIN-Pfad](../security/pin-pfad-mandanten-scope.md) (#332).

## Problem

Eine Custom Method bekommt eine ID herein und lädt den Datensatz intern. Keine
der drei Schutzschichten greift dabei:

| Schicht | Warum sie nicht greift |
|---|---|
| `multiTenancy` | schaltet **nur** auf `create`/`update`/`patch` (Stamping) und `find`/`get`/`remove`/`update`/`patch` (Scoping). Ein Name wie `convert` trifft keine der Listen — der Hook ist ein **No-Op**, steht aber in `around.all` und sieht dort wie ein Schutz aus. |
| der innere `get` | läuft mit `{ provider: undefined }` und ist damit per Definition ungescoped. |
| `ensureTenantIsolation` | ist ein App-Level-**after**-Hook: Er prüft das Ergebnis, kommt also nach dem Write. Stempelt die Methode den Datensatz unterwegs auf den Aufrufer um, sieht er überhaupt keinen Unterschied mehr. |

**Die mittlere Zeile ist die gefährliche:** Der Hook steht da, wo man ihn sucht,
und tut nichts.

### Was gemessen wurde

An `pre-orders.convert()` am 2026-09-22, Angreifer `tenant:staff`, Stand vor dem
Fix — gegen die echte SQLite und die volle Hook-Kette:

```
Fehler geworfen: NEIN
Rueckgabe:       Order 01a0c915-d586-…
Orders in DB:    1 (tenantId=eigener, locationId=FREMD)
Vorbestellung:   status=converted
```

Die fremden `lineItems` landen in einer Order mit dem **eigenen** `tenantId` —
für den Aufrufer also lesbar. Das ist Datenabfluss, nicht nur ein
Fremdschreibzugriff. Zusätzlich ist die fremde Vorbestellung zerstört
(`CONVERTED`) und die neue Order zeigt auf eine fremde Filiale. HTTP 200, kein
Alarm.

### Erreichbarkeit — Edge und Cloud unterscheiden sich

| | Vorbedingung | Bewertung |
|---|---|---|
| **Edge** | Ein fremder Datensatz muss in derselben SQLite liegen. `pre-orders` wird **gar nicht gesynct**, und ein Edge bedient genau **eine** Filiale. Bleibt eine gemischte Mandanten-Historie aus Re-Pairing — vom Code selbst als „sollte praktisch nicht vorkommen" benannt. | bedingt |
| **Cloud** | Keine. Alle Mandanten liegen in **derselben** MongoDB. | **unbedingt** |

⚠️ Das Issue argumentierte, `isolateLocation: true` am Service lege Mehr-Filialen-Edges
nahe. Das ist widerlegt: Die Option steht auf 24 von ~37 Edge-Services, und der
Code nennt Multi-Location ausdrücklich „zukuenftig".

## Entscheidung

**1. Ein geteilter Helfer** `checkCallerOwnsRecord` / `assertCallerOwnsRecord` in
`@panary/shared-backend`, `util-security/caller-owns-record.ts`. Alle vier
Stellen rufen ihn auf.

**2. Fail-closed als Default.** Ein authentifizierter Aufrufer **ohne**
`tenantId` und ohne Plattform-Rolle wird **abgewiesen**. Die bisherigen Fassungen
schrieben `if (actor.tenantId && target.tenantId !== actor.tenantId)` und prüften
damit genau dann nicht, wenn der Mandantenkontext fehlte — im unklarsten Fall.

**3. Eine benannte Ausnahme statt einer stillen Bedingung.**
`allowMissingTenantContext` erlaubt einen **fehlenden** Mandanten, nie einen
falschen.

**4. `assert…` vor jedem Write.** Feathers rollt nichts zurück; ein Check danach
lässt die Zeile stehen.

**5. In der geteilten Lib, nicht app-lokal** — siehe unten.

### Die Annahme, die beim Messen umfiel

Der Umbau startete mit „die bedingte Form war überall Nachlässigkeit". Das ist
**falsch**. Der virtuelle Geräte-User **vor dem Pairing** (`device:*` ohne
Mandant) muss am POS stempeln können, bevor der Edge einem Mandanten zugeordnet
ist — festgehalten in `time-clock-scope.spec.ts`. Fail-closed als Pauschalregel
hätte den POS vor dem Pairing gesperrt.

Deshalb Punkt 3. Die alte Form war an dieser einen Stelle Absicht; neu ist, dass
die Ausnahme dasteht, statt sich aus einem `&&` zu ergeben — und dass sie überall
sonst **nicht** gilt.

### Warum geteilt, obwohl #189 das Gegenteil entschied

`time-clock-scope.ts` trägt die Gegenentscheidung im Kopfkommentar: Der Scope
blieb app-lokal, weil ein geteilter Helfer aus einem Sicherheitsfix eine Kette
über beide Repos macht (Lib-Änderung → Core-Release → Cloud-Pin-Bump →
Cloud-Umbau).

Das Argument gilt weiter — hier ist die Kette **Absicht**:

- Der Cloud-Zwilling trägt denselben Defekt und ist dort **unbedingt**
  erreichbar. Er braucht ohnehin eine eigene PR.
- panary-cloud konsumiert `@panary/shared-backend` bereits (`^26.9.6`). Nach dem
  Pin-Bump ist der Cloud-Fix ein Aufruf statt einer vierten Abschrift.
- Ein Core-Release steht ohnehin an (#346, #347 warten auf einen Tag), und
  panary-cloud braucht denselben Pin-Bump für cloud#487.

Die Kette kostet hier also nichts, was nicht ohnehin anfiele.

## Konsequenzen

**Der Edge-Defekt ist geschlossen**, belegt durch einen Regressionstest, der den
**Datenbankzustand** prüft statt des Statuscodes — weder Order noch Patch. Ein
reiner 403-Test wäre grün geblieben, während die Zeile schon steht; vor dem Fix
antwortete der Aufruf ohnehin mit 200. Zwei Mutationsproben halten das fest.

**🚨 Der Cloud-Zwilling bleibt offen** und ist die gefährlichere Hälfte.

**`business-days` antwortet jetzt 403 statt 400.** „Gehört dir nicht" ist keine
fehlerhafte Anfrage. Einziger Konsument der alten Meldung war eine Spec.

**⚠️ `verifyPin`/`changePin` wurden NICHT verschärft.** Sie setzen
`allowMissingTenantContext` und verhalten sich unverändert. Ob ein Aufrufer ohne
Mandant sie überhaupt erreichen kann, ist **ungemessen** und von keinem Test
gedeckt. Das blind zu schließen hieße, den PIN-Login am POS gegen eine Vermutung
zu tauschen — es gehört gemessen, bevor es verschärft wird.

**Nicht erfasst:** `sync-outbox.reEnqueue` (die Tabelle hat keine
`tenantId`-Spalte, die Methode reicht `params` nicht durch) und die
`sync-conflicts`-Ladepfade (before-Hooks, keine Custom Methods) — strukturell
verwandt, aber außerhalb der Klasse.

**Ob in Bestandsinstallationen bereits fremde Konvertierungen stattgefunden
haben, lässt sich nicht feststellen.** Ein legitimer und ein illegitimer Aufruf
sehen in den Daten identisch aus.

## Regel für neue Custom Methods

> **Lädt eine Custom Method einen Datensatz per ID, ruft sie unmittelbar danach
> `assertCallerOwnsRecord` — vor jedem Write.** Dass `multiTenancy` in
> `around.all` steht, ist kein Schutz; für Custom-Methodennamen ist er ein No-Op.

## Status

Entschieden und umgesetzt 2026-09-22
([#357](https://github.com/panary/panary-core/issues/357)). Der Cloud-Teil steht aus.
