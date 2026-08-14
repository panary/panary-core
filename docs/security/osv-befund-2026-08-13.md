---
type: Report
title: OSV-Befund 2026-08-13 — nanoid 3.3.17 nachträglich in die Advisory-Range gerutscht
description: Eine Range-Erweiterung an GHSA-2v37-7h3g-55p8 machte den bisherigen Fix 3.3.17 selbst verwundbar; der Nachfolger 3.3.18 wurde ohne Karenz-Ausnahme abgewartet, und dabei zeigte sich, dass weder pnpm install noch ein zu früher pnpm update die Version hebt — beide laufen still mit Exit 0 durch.
tags: [security, supply-chain, dependencies, ci]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-13T18:45:00.000Z }
---

# OSV-Befund 2026-08-13 — nanoid 3.3.17 nachträglich in die Advisory-Range gerutscht

## Auslöser: dieselbe Mechanik wie am 2026-08-07

[GHSA-2v37-7h3g-55p8](https://osv.dev/GHSA-2v37-7h3g-55p8) ist am 2026-07-29
veröffentlicht, trägt aber den `modified`-Stempel **2026-08-13T16:00:06 UTC**.
Dabei sprang `fixed` von `3.3.17` auf `3.3.18` — **der Fix, den wir am
2026-08-07 eingezogen hatten, war unvollständig und ist jetzt selbst betroffen.**

Aufgefallen ist das in panary-cloud, dessen `osv-scanner`-Job um 17:49 UTC
anschlug. core führte dieselbe `nanoid@3.3.17` mit demselben Override; der
letzte core-Scan lief um 05:48 UTC, also vor der Änderung, und wäre in der
folgenden Nacht ohne jedes Zutun rot geworden. Der Befund wurde deshalb im
selben Zug mit nachgezogen, statt auf den roten Lauf zu warten
(panary/panary-cloud#243).

Der Merksatz aus [dem Vorgängerbefund](osv-befund-2026-08-07.md) bestätigt sich
damit zum zweiten Mal in einer Woche, in der schärferen Lesart: Nicht nur ein
grüner Scan von gestern sagt nichts über heute — **auch ein Fix von gestern ist
morgen womöglich keiner mehr.**

Die zweite Advisory-Range (`4.0.0`–`5.1.6`) ist gegenstandslos: Das Lockfile
führt genau eine `nanoid`, und `postcss` ist ihr einziger Konsument.

## Kein Override-Bump — der Caret war schon durchlässig

Der naheliegende Reflex wäre, den Override zu heben. Er ist hier **falsch**:
`nanoid: '^3.3.17'` steht seit dem 2026-08-11 in `pnpm-workspace.yaml` und
**lässt 3.3.18 bereits zu**. Was die Resolution bei 3.3.17 hielt, war allein die
7-Tage-Karenz. Die einzige offene Frage war der Zeitpunkt, nicht die
Konfiguration — ein Exakt-Pin auf `'3.3.18'` wäre sogar schädlich, weil er den
nächsten Patch blockiert.

## Die Entscheidung: gewartet statt ausgenommen

`nanoid@3.3.18` ist am **2026-08-07 um 16:41:05 UTC** publiziert
(`npm view nanoid time`) und wird bei `minimumReleaseAge: 10080` am
**2026-08-14 um 16:41 UTC** reif — zum Zeitpunkt des Befunds in knapp 23 Stunden.

Ein befristeter `minimumReleaseAgeExclude`-Eintrag hätte den Fix früher
verfügbar gemacht. Die Abwägung fiel am 2026-08-13 gemeinsam mit dem Nutzer auf
**warten**:

1. Ein solcher Eintrag ist genau der „stille Verzicht auf die Karenz für genau
   das Paket, das gerade erst gepatcht wurde", vor dem der Kommentar in
   `pnpm-workspace.yaml` warnt — und dieser Fall belegt die Warnung: Der zuletzt
   eilig eingezogene Fix (3.3.17) war der, der sich als unvollständig erwies.
2. Der Eintrag hätte nach ~23 Stunden wieder entfernt werden müssen.
3. Die Angriffsvorbedingung ist auf dem gemessenen Pfad nicht erfüllt (unten).

Die Wartezeit ist **kein** Automatismus, sondern eine Einzelfallabwägung. Wäre
der Aufrufpfad erreichbar gewesen, hätte sie anders ausfallen können.

## 🚨 Der teuerste Fund: beide Wege scheitern lautlos

Beim Vorbereiten wurde in einem Wegwerf-Projekt mit identischer Konfiguration
(`minimumReleaseAge: 10080`, `nanoid: '^3.3.17'`, Konsument `postcss`) gemessen —
mit **pnpm 10.34.3**, der Version aus `packageManager`; „abgelaufen" ist über
`minimumReleaseAge: 0` simuliert:

| Lauf | Karenz | Ergebnis | Exit |
| --- | --- | --- | --- |
| `pnpm install --lockfile-only` | abgelaufen | bleibt auf **3.3.17** | 0 |
| `pnpm update nanoid --lockfile-only` | abgelaufen | geht auf **3.3.18** | 0 |
| `pnpm update nanoid --lockfile-only` | scharf | bleibt auf **3.3.17** | 0 |

**`pnpm install` hebt die Version nicht.** Ein aktuelles Lockfile wird gar nicht
neu aufgelöst; dass eine Version inzwischen reif geworden ist, triggert nichts.
Das erweitert einen bereits festgehaltenen Befund — das Log vom 2026-08-11 notiert
dieselbe Beobachtung für das *Entfernen* von Excludes. Es braucht
`pnpm update <paket>`.

**`pnpm update` scheitert vor der Reife nicht — es tut nichts.** Kein
`ERR_PNPM_NO_MATURE_MATCHING_VERSION`, keine Warnung, Exit 0. Der Fehler entsteht
nur, wenn im Range **keine** reife Version liegt; hier liegt mit 3.3.17 eine reife
Alternative darin, und pnpm nimmt still die ältere. Wer vor 16:41 UTC startet,
bekommt einen erfolgreichen Lauf und ein unverändertes Lockfile.

> **Konsequenz für jeden künftigen Karenz-Fall:** Der Nachweis ist die Version im
> Lockfile, nie der Exit-Code.
>
> ```bash
> grep -oE '^  nanoid@[0-9.]+' pnpm-lock.yaml | sort -u
> ```

## Angriffsvorbedingung — unverändert nicht erfüllt

Die Endlosschleife sitzt in `customRandom`/`customAlphabet` des
*secure*-Entrypoints und setzt einen eigenen Generator voraus, der eine
angreiferkontrollierte Größe 0 entgegennimmt. Die Messung aus dem
[Vorgängerbefund](osv-befund-2026-08-07.md) gilt für 3.3.17 unverändert: kein
direkter `nanoid`-Import, keine Verwendung von `customAlphabet`/`customRandom`,
und `postcss` ruft `nanoid(6)` aus `nanoid/non-secure` — feste Größe, eigener
Codepfad.

Das ist der Grund, warum ein Tag Wartezeit vertretbar war. Es ist **kein** Grund,
den Fix zu unterlassen: Belegt ist der untersuchte Aufrufpfad, nicht die
Abwesenheit jeder denkbaren Erreichbarkeit.

## Verifikation

Ab dem 2026-08-14 16:41 UTC, im Worktree (**nicht** unterhalb von `.claude/` —
osv-scanner überspringt Punkt-Verzeichnisse und meldet dort „No issues found",
ohne etwas gescannt zu haben):

```bash
pnpm update nanoid

# Nachweis — muss 3.3.18 zeigen:
grep -oE '^  nanoid@[0-9.]+' pnpm-lock.yaml | sort -u

# Gates:
osv-scanner scan source --lockfile pnpm-lock.yaml
node scripts/security-scan.mjs
```

Anders als panary-cloud hat core nur **ein** Lockfile (keine
Storefront-Runtime-Closure) und **kein** `pnpm audit`-Gate — hier zählen allein
`osv-scanner` und `scripts/security-scan.mjs`.

> ⚠️ Nach dem Merge: `panary-core/pnpm-lock.yaml` ist im Workbench-Haupt-Checkout
> ein Symlink mit `skip-worktree`. Weil dieser Change das Lockfile **ändert**,
> bleibt das automatische Nachziehen durch `wt.sh done` stehen und die
> symlink-schonende Sequenz ist von Hand fällig.

Verwandt: [OSV-Befund 2026-08-07](osv-befund-2026-08-07.md) (Vorgänger, dessen
nanoid-Fix dieser Befund ablöst). Das Pendant in panary-cloud behandelt denselben
Befund dort, samt der zusätzlichen Runtime-Closure (panary/panary-cloud#243).
