---
type: ADR
title: ADR-Index generiert statt gepflegt — Liste raus, Nummer maschinell abgestimmt
description: Die annotierte ADR-Liste verlässt docs/adr/index.md und wird on demand aus dem Frontmatter gerendert; die nächste freie Nummer bestimmt ein Befehl über origin/main und alle Worktrees statt einer Prozessregel.
tags: [ci, docs, tooling]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-08-11T11:10:00.000Z }
---

# ADR-Index generiert statt gepflegt — Liste raus, Nummer maschinell abgestimmt

Umsetzung: panary/panary-core#161. **Spiegel von
[panary-cloud ADR 0049](../../../panary-cloud/docs/adr/0049-adr-index-generiert-statt-gepflegt.md)**
(panary/panary-cloud#179, PR #183) — dort steht die ausführliche Herleitung. Dieses ADR hält
fest, was für panary-core gilt, und begründet die Angleichung.

## Problem

`docs/adr/index.md` trug eine von Hand gepflegte Liste `* [Titel](NNNN-….md) - description`.
Jeder ADR-PR hängte genau eine Zeile an genau dieselbe Stelle — das Listenende. Damit war die
Datei exakt die Konfliktklasse, gegen die `docs/log.md` durch Fragmente in `docs/log.d/`
abgelöst wurde (#137).

Der teure Teil ist dabei nicht die Auflösung, sondern was ihr vorausgeht:

> **Ein konfliktbehafteter PR startet bei GitHub gar keine Checks.** Der PR sieht aus, als
> liefe die CI, und hängt in Wahrheit still.

In panary-cloud schlug das am 2026-08-10 zweimal in einer Session zu. In core ist der ADR-Takt
langsamer (24 statt 48 ADRs), die Eigenschaft der Datei aber identisch — der Unterschied ist
Häufigkeit, nicht Art.

Dazu die Nummernvergabe: `ls docs/adr/` sieht nur den eigenen Worktree. In panary-cloud hatten
deshalb drei parallele Sessions gleichzeitig `0046` belegt (cloud#133, #148, #129); zwei mussten
umnummerieren, und aufgefallen ist es erst über einen bereits gemergten Kommentar in **diesem**
Repo. Die Kollision ist also nicht einmal repo-lokal geblieben.

Drittens driftet eine Handliste. Der Round-Trip beim Bau des Generators deckte in core **zwei**
Fälle auf: [ADR 0019](0019-edge-429-rueckstau-behandlung.md) stand mit gekürztem Titel im Index,
[ADR 0020](0020-sinclair-typebox-an-feathers-koppeln.md) mit einer älteren Fassung der
`description`. 22 von 24 Zeilen stimmten; verglichen hatte die beiden Quellen nie jemand.

## Entscheidung

**panary-core wird an panary-cloud angeglichen** — kein bewusstes Auseinanderlaufen. Zwei Wikis
mit gegensätzlicher ADR-Pflege wären eine Regel, die man je Repo nachschlagen muss; der
Häufigkeitsunterschied rechtfertigt das nicht, zumal der Drift-Befund oben zeigt, dass der
langsamere Takt die Handpflege nicht zuverlässiger macht, sondern nur unauffälliger.

**Die Liste verlässt `docs/adr/index.md` und wird nicht committet.** `pnpm docs:adr:index`
rendert sie on demand aus `title` + `description` im Frontmatter nach stdout. `index.md` bleibt
als kurze Erklärseite bestehen und wird von ADR-PRs nicht mehr angefasst.

**Die Nummer bestimmt ein Befehl, keine Regel.** `pnpm docs:adr:next` sammelt die belegten
Nummern aus `origin/main`, aus dem eigenen Baum und aus jedem weiteren Worktree desselben Repos
(`git worktree list --porcelain`) und gibt die höchste + 1 aus. Lücken werden nie aufgefüllt:
Eine Lücke bedeutet, dass eine Session ihre Nummer aufgegeben hat — der Wert steht dann
womöglich schon in einem Issue-Kommentar.

**`pnpm docs:adr:index:check` ist CI-Gate** (eigener Step neben dem Log-Check) und prüft
Dateinamen, `type`/`title`/`description` sowie doppelte Nummern. Dazu ein Drift-Schutz: Findet
der Check in `index.md` eine Zeile in generierter Listenform, bricht er ab — ohne ihn wächst
die Liste dort still nach und der Konflikt ist zurück.

**Das Skript ist eine bewusste Kopie der cloud-Fassung**, zeichengleich bis auf den Kopf-Kommentar
und die ADR-Nummer in der Drift-Meldung. Eine geteilte Bibliothek gäbe es nur über die
`@panary/*`-Registry ([ADR 0002](0002-library-publishing.md)), und ein Repo-Werkzeug dort
einzuhängen hieße, den Build der Doku-Gates an den Release-Zyklus der Domain-Pakete zu koppeln.
Bei ~200 Zeilen ohne Fachlogik ist die Duplikation billiger als diese Kopplung; der Preis ist,
dass eine Änderung an beiden Stellen nachgezogen werden muss.

Die Sequenz `NNNN` **bleibt**. „ADR 0018" wird quer durch beide Repos und in Memories zitiert;
ein Wechsel auf die Issue-Nummer als Diskriminator (die `log.d`-Antwort) würde alle Verweise
brechen und die chronologische Ordnung verlieren.

## Konsequenzen

- Ein neuer ADR fasst **keine geteilte Datei** mehr an: nur die eigene `NNNN-*.md` und das
  Log-Fragment in `docs/log.d/`. Die Konfliktfläche zwischen zwei ADR-PRs ist null.
- Die annotierte Liste ist auf github.com nicht mehr durchblätterbar — wer sie braucht, ruft
  `pnpm docs:adr:index` auf. Bewusst in Kauf genommen; `docs/index.md` verweist unverändert auf
  den Ordner, nicht auf einzelne ADRs.
- Titel und `description` sind ab jetzt per Konstruktion identisch mit dem Frontmatter. Die
  Drift bei 0019 und 0020 kann nicht wieder entstehen.
- `--next` zählt auch die Ephemeral-Worktrees mit, die Claude Code für Subagenten unter
  `.claude/worktrees/` anlegt. Das ist Absicht: Ein veralteter Baum kann die Zahl nur zu hoch
  schätzen, also höchstens eine Nummer verbrennen — nie eine doppelt vergeben.
- Der Doppelnummern-Check greift innerhalb eines Baums. Zwei offene PRs mit derselben Nummer
  sieht er erst, wenn beide auf `main` liegen — dann aber laut. `docs:adr:next` ist die
  Vorbeugung, das Gate das Netz.
- `.claude/rules/documentation.md` §3/§4 entfällt die Index-Pflege für `docs/adr/`; für alle
  anderen Ordner bleibt sie unverändert.
- Die Übergangsregel in `_WORKBENCH_PANARY/.claude/rules/workflow-plan-issue-worktree.md` §3
  („core: noch Handprüfung") entfällt mit diesem ADR und wird nachgezogen.
