---
type: ADR
title: '@sinclair/typebox an @feathersjs/typebox koppeln — die direkte Dependency folgt dem Peer, nicht der neuesten Version'
description: Die Root-Deklaration von @sinclair/typebox zieht von ^0.34.0 auf ^0.25.0 und damit exakt auf den Bereich, den @feathersjs/typebox selbst deklariert; damit verschwinden zwei nominal unvereinbare TSchema-Typen und 96 TS2345-Fehler in fünf Domain-Libs.
tags: [dependencies, typescript, orders, sync, brands, reservations, audit-events]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-05T18:20:00.000Z }
---

# @sinclair/typebox an @feathersjs/typebox koppeln

## Problem

`nx run-many -t typecheck` scheiterte in fünf Domain-Libs mit 96 × TS2345 — `orders` (29),
`brands` (30), `reservations` (23), `sync` (10), `audit-events` (4). Die Meldung ist in allen
Fällen dieselbe:

```
Argument of type 'TObject<...>' is not assignable to parameter of type 'TSchema'.
  Property '[Kind]' is missing in type 'TObject<...>' but required in type 'TSchema'.
```

Im Store lagen zwei `@sinclair/typebox`-Instanzen:

| Version | Herkunft |
| --- | --- |
| `0.25.24` | transitiv über `@feathersjs/typebox@5.0.46` (`"@sinclair/typebox": "^0.25.0"`) |
| `0.34.49` | direkte devDependency im Root-`package.json` (`"^0.34.0"`) |

Die Schemas (`libs/domains/*/domain/src/lib/*.schema.ts`) importieren `Type` aus
`@feathersjs/typebox` und sind damit gegen 0.25 typisiert. Die Specs importierten `Value` und
`FormatRegistry` direkt aus `@sinclair/typebox` und bekamen 0.34. `[Kind]` ist ein
`unique symbol`; zwei Deklarationen sind nominal verschieden, auch wenn sie zur Laufzeit über
`Symbol.for('TypeBox.Kind')` derselbe Wert sind. Genau daher rührt der Widerspruch, dass die
Tests grün liefen, während der Typecheck rot war.

Die `^0.34.0` war nie eine Entscheidung. Commit `58e4182` hat sie eingeführt, damit
`sync-trigger.schema.spec.ts` seine direkten Imports im Standalone-CI überhaupt auflösen kann
(`workspaces: ["packages/*"]` — die Lib-`package.json` unter `libs/` werden dort nicht
installiert, nur Root-Deps landen in `node_modules`). Gegriffen wurde zur damals neuesten
Version, ohne den Peer von Feathers zu prüfen.

Sichtbar wurde der Fehler erst durch [#110](https://github.com/panary/panary-core/pull/110):
vorher starb der Typecheck an der Konfiguration, bevor er eine einzige Datei erreichte.

## Entscheidung

Die direkte Dependency deklariert denselben Bereich wie Feathers — `^0.25.0` statt `^0.34.0`.
Identischer Bereich heißt garantierte Deduplizierung: Root und `@feathersjs/typebox` zeigen auf
dieselbe Store-Instanz, TypeScript löst über `realpath` auf dieselbe `typebox.d.ts` auf, und
es gibt nur noch ein `TSchema`.

Die Format-Registrierung in den Specs heißt in 0.25 `Format` und liegt im Unterpfad
`@sinclair/typebox/format`; ab 0.26 wurde daraus `FormatRegistry` im Wurzel-Export. Vier Specs
ziehen entsprechend nach — reine Umbenennung, `Has`/`Set` sind signaturgleich.

**Verworfen: pnpm-`override` auf `^0.34`.** Das ist nicht bloß riskant, es funktioniert nicht.
`@feathersjs/typebox@5.0.46` re-exportiert `Modifier` und `TypeBuilder`; beide hat 0.34
entfernt (verifiziert gegen die installierten Pakete). Ein Override hätte die Schema-Schicht des
gesamten Backends gegen eine Version gezwungen, die die benötigten Symbole nicht mehr hat.

**Verworfen: Import-Umbau der Specs auf `@feathersjs/typebox`.** Dessen `index.d.ts` macht zwar
`export * from '@sinclair/typebox'`, doch `Value` und `FormatRegistry` liegen in 0.25 in
Unterpfaden (`/value`, `/format`) und werden von einem Wurzel-`export *` nicht erfasst — zur
Laufzeit exportiert das Paket nur `Kind, Hint, Modifier, TypeBuilder, Type` weiter.

## Konsequenzen

- **Die Kopplung ist ab jetzt die Regel:** Steigt `@feathersjs/typebox` auf eine neuere
  TypeBox-Linie, zieht die Root-Deklaration im selben Schritt mit. Ein isolierter Bump von
  `@sinclair/typebox` — auch durch Dependabot — bringt die zweite Instanz zurück und damit
  dieselben 96 Fehler. Ein `dependabot.yml`-`ignore` für das Paket wäre die konsequente
  Absicherung; bewusst nicht Teil dieser Änderung.
- **Kein Verhaltensunterschied in den Tests.** Beide Versionen lassen `Value.Check` an einem
  nicht registrierten `format` *scheitern* (empirisch geprüft, 0.25 und 0.34 identisch). Die
  `beforeAll`-Registrierungen decken damit weiterhin genau die Formate ab, die die geprüften
  Schemas verwenden; keine Testsemantik verschiebt sich. Die fünf Suiten laufen unverändert grün.
- **Der Store enthält weiterhin 0.34.49** — als private Dependency von `@jest/schemas`. Die ist
  für unseren Quellcode unerreichbar und damit unkritisch; „eine Instanz im Lockfile" ist nicht
  das Ziel, „eine Instanz im Auflösungspfad unseres Codes" schon.
- **Das Backend ist nicht betroffen.** Was `@feathersjs/typebox` auflöst, war vorher 0.25.24 und
  ist es nachher; die Schema-Validierung von `api-edge` sieht keine Änderung. Außerhalb der
  fünf Specs importiert nichts im Repo `@sinclair/typebox` direkt (geprüft über `libs`, `apps`,
  `tools`).
- **Offen und bewusst getrennt:** 37 Domain-`package.json` führen `@sinclair/typebox: ^0.34.0`
  in den `peerDependencies`. Keine einzige der 35 gebauten `dist/index.d.ts` referenziert das
  Paket, der Eintrag ist also für den veröffentlichten Typ-Vertrag folgenlos — er nennt
  Konsumenten (u. a. panary-cloud) aber die falsche Linie. Das anzupassen ändert publizierte
  Paket-Metadaten und gehört in einen eigenen Schritt.

Siehe auch: [ADR 0012 — pnpm-Supply-Chain-Härtung](0012-pnpm-supply-chain-haertung.md).
