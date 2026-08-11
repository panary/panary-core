# ADRs — Architektur-Entscheidungen

Verbindliche Entscheidungen mit Bindungswirkung (`type: ADR`, Dateiname `NNNN-<kebab-titel>.md`,
Body: Problem → Entscheidung → Konsequenzen). Regeln: `.claude/rules/documentation.md`.

Die annotierte Liste steht **absichtlich nicht mehr hier**. Sie war die eine Zeile, die jeder
ADR-PR am selben Ort anhängte — dieselbe Konfliktklasse, wegen der die Historie in
`docs/log.d/` liegt. Begründung: [ADR 0025](0025-adr-index-generiert-statt-gepflegt.md).

```bash
pnpm docs:adr:index   # annotierte Liste (Titel + description) nach stdout
pnpm docs:adr:next    # nächste freie Nummer — über origin/main UND alle Worktrees
```

Beim Anlegen eines ADR ist deshalb **nichts** an einer geteilten Datei zu pflegen: nur die neue
`NNNN-*.md` und das Log-Fragment in `docs/log.d/`. `pnpm docs:adr:index:check` prüft in der CI
Dateinamen, Frontmatter-Pflichtfelder und doppelte Nummern.
