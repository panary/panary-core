# Wiki Update Log

Die Historie liegt als Einzeldateien in [`log.d/`](log.d/) — eine Datei je Eintrag,
benannt `<YYYY-MM-DD>-<nr>-<slug>.md`. Zusammengesetzte Ansicht:

```bash
pnpm docs:log
```

**Diese Datei bekommt keine Einträge mehr.** Sie war die Datei, auf der parallele PRs
konfligierten: Jeder Eintrag kam ganz nach oben, zwei gleichzeitige Branches schrieben
also auf dieselbe Zeile, und der erzwungene Update-Merge kostete jedes Mal einen
kompletten CI-Lauf ([#137](https://github.com/panary/panary-core/issues/137)).
Fragmente teilen sich keine Zeile, deshalb gibt es den Konflikt nicht mehr.
