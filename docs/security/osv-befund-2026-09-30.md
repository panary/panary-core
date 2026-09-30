---
type: Report
title: OSV-Befund 2026-09-30 — ip-address und moment per Override-Floor, Floors an panary-cloud angeglichen
description: Drei am 2026-09-29 veröffentlichte Advisories trafen ip-address 10.7.0 (über socks 2.8.9) und moment 2.30.1 (über file-stream-rotator); beide sind über Override-Floors geschlossen, und fünf weitere Floors, die hinter panary-cloud zurücklagen, ohne Resolutionsänderung auf den cloud-Stand gehoben.
tags: [security, supply-chain, dependencies]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-09-30T07:00:00.000Z }
---

# OSV-Befund 2026-09-30 — ip-address und moment per Override-Floor, Floors an panary-cloud angeglichen

## Auslöser

Am 2026-09-29 gegen 23:46 UTC erschienen drei Advisories auf Bestandspaketen. In
panary-cloud standen danach osv-scanner und `pnpm audit --prod` auf jedem PR rot
(panary/panary-cloud#740, PR panary/panary-cloud#749). core ist teilweise betroffen.
Umgesetzt in panary/panary-core#443.

| Advisory | Paket | Befund | betroffen | Fix | Schwere |
| --- | --- | --- | --- | --- | --- |
| [GHSA-h3mg-xc3c-68pw](https://osv.dev/GHSA-h3mg-xc3c-68pw) | ip-address | `Address6` baut eine eingabeproportionale Diagnose ohne Längengrenze auf (DoS) | `< 10.7.1` | 10.7.1 | moderate |
| [GHSA-j6r3-76f7-8jcv](https://osv.dev/GHSA-j6r3-76f7-8jcv) | ip-address | `isInSubnet()` vergleicht Adressen verschiedener Familien, Allowlist-Umgehung | `< 10.7.1` | 10.7.1 | moderate |
| [GHSA-4p3w-j4w9-5jqw](https://osv.dev/GHSA-4p3w-j4w9-5jqw) | moment | Path Traversal über einen präparierten Nicht-String-Locale-Namen | `>= 2.29.2, < 2.31.0` | 2.31.0 | moderate |

## Betroffene Resolutionen in core

Gemessen am Lockfile von `origin/main` @ `21d8c403`:

| Paket | aufgelöst | Herkunft |
| --- | --- | --- |
| ip-address | **10.7.0** neben 10.7.2 | `socks@2.8.9` (SOCKS-Pfad von mqtt). Die zweite Kopie `socks@2.8.10` und express-rate-limit hatten schon 10.7.2 |
| moment | **2.30.1** | `file-stream-rotator@0.6.1` über `winston-daily-rotate-file` (Log-Rotation am Edge) |

Beide sind Laufzeit-Abhängigkeiten von `api-edge`, nicht dev-only.

## Maßnahme

`package.json` → `pnpm.overrides`:

| Paket | vorher | nachher | Wirkung auf das Lockfile |
| --- | --- | --- | --- |
| ip-address | `^10.2.1` | `^10.7.1` | 10.7.0 entfällt, nur noch 10.7.2 |
| moment | — | `^2.31.0` | 2.30.1 → 2.31.0 |
| brace-expansion | `^5.0.9` | `^5.0.12` | keine (löste schon 5.0.12 auf) |
| engine.io | — | `^6.6.10` | keine (löste schon 6.6.10 auf) |
| fast-uri | `^3.1.6` | `^3.1.7` | keine (löst 3.1.8 auf) |
| hono | `^4.12.34` | `^4.13.5` | nur der Peer-Range von `@hono/node-server` (löst 4.13.8 auf) |
| undici | `^7.29.0` | `^7.29.1` | keine (löst 7.29.1 auf) |

Die ersten vier stammen aus panary/panary-cloud#749. Die letzten drei fand der
Floor-Drift-Vergleich core ↔ cloud: Die Resolutionen lagen schon über dem cloud-Floor, die
Deklaration erlaubte aber weiter die ungepatchte Version. Ein Scan sieht so etwas nicht
(Muster aus panary/panary-core#168); scharf wird es erst, wenn eine Neuauflösung die neuere
Version wegen der Karenz nicht wählen kann.

Nach der Änderung stimmen alle 45 gemeinsamen Override-Schlüssel mit dem cloud-Stand des
PR-Branches `feat/740-advisories-2026-09-30` überein.

**Karenz:** ip-address 10.7.1/10.7.2 und moment 2.31.0 sind am 2026-09-15 erschienen und
seit 2026-09-22 reif. Eine Ausnahme in `minimumReleaseAgeExclude` war nicht nötig. Nachweis
ist die Version im Lockfile, nicht der Exit-Code.

## Gemessen

```bash
pnpm install --lockfile-only          # ohne vorheriges rm
git diff --stat                       # pnpm-lock.yaml: 30 Zeilen, nur die sieben Pakete
grep -oE '^  (ip-address|moment|brace-expansion|engine.io)@[0-9.]+' pnpm-lock.yaml | sort -u
# brace-expansion@5.0.12  engine.io@6.6.10  ip-address@10.7.2  moment@2.31.0
pnpm install --frozen-lockfile        # node_modules nachziehen, sonst messen Tests die alten Versionen
```

| Messung | Ergebnis |
| --- | --- |
| `pnpm audit --audit-level=moderate --prod` | `No known vulnerabilities found` |
| `osv-scanner scan -L pnpm-lock.yaml` | `No issues found` (2011 Pakete) |
| Verlinkte Laufzeitversion (`require.resolve` über `winston-daily-rotate-file` → `file-stream-rotator`) | moment 2.31.0 |
| `node_modules/.pnpm/socks@*/node_modules/ip-address` | beide Kopien → 10.7.2 |

`--lockfile-only` aktualisiert `node_modules` nicht. An panary/panary-cloud#740 maß der
erste Gate-Lauf deshalb noch die alten Versionen.

## Nicht belegt

Die Tests decken das Laufzeitverhalten nur teilweise ab: das Datumsformat der
Rotationsdateien unter moment 2.31 und den SOCKS-Proxy-Pfad von mqtt mit ip-address 10.7.2.
Der Sichttest am Edge prüft beides.

Verwandt: [ADR 0012 — pnpm-Supply-Chain-Härtung](../adr/0012-pnpm-supply-chain-haertung.md),
[OSV-Befund 2026-09-26](osv-befund-2026-09-26.md). Das Pendant in panary-cloud
(`docs/security/osv-befund-2026-09-30.md`) behandelt zusätzlich brace-expansion und engine.io,
die dort verwundbar aufgelöst waren.
