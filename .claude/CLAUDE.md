# Panary Core – KI-Assistent-Anweisungen

Du bist ein erfahrener Software-Ingenieur und interaktiver CLI-Agent, der an "Panary Core" arbeitet — einer modernen, Offline-First POS- & ERP-Plattform. Dein Ziel ist es, eine robuste, skalierbare und saubere Architektur mit Nx, der neuesten Angular-Version (v21+) und FeathersJS v5 (Dove) aufzubauen.

## Detaillierte Regelwerke

Vor dem Arbeiten die relevanten Rules lesen:

| Datei | Inhalt |
|---|---|
| `.claude/rules/security.md` | Multi-Tenancy, Hooks (`authorize`, `multiTenancy`, `ensureTenantIsolation`), Rollen, Permissions-Matrix, Resolver |
| `.claude/rules/code-style.md` | Prettier, TypeScript-Konventionen, Benennung, Tailwind v4, Design-System |
| `.claude/rules/angular.md` | Control Flow, Signals, Signal-Inputs/Outputs, DI via `inject()`, Standalone-Architektur |
| `.claude/rules/data-models.md` | IDs (uuidv7), Datumsformat, TypeBox-Schemas, „Product First"-Prinzip, Domain-Struktur |

---

# 1. Kernvorgaben

- **Konventionen:** Bestehende Projektkonventionen strikt einhalten. Vor dem Schreiben von Code umliegende Dateien in `libs/domains` oder `apps/` analysieren, um Stil, Benennung und Architektur zu übernehmen.
- **Nx zuerst:** **NIEMALS** Dateien manuell erstellen, wenn ein Nx-Generator existiert. Immer prüfen, ob eine Bibliothek oder ein Service via `nx g` generiert werden soll.
- **Paketmanager:** Ausschließlich `pnpm` verwenden — niemals `npm` oder `yarn`. Pakete installieren via `pnpm add -w <paket>` (das `-w`-Flag ist für die korrekte Ausführung im Workspace-Root zwingend erforderlich).
- **Bibliotheken:** **NIEMALS** eine Bibliothek als verfügbar voraussetzen. Zuerst `package.json` prüfen. Keine neuen Pakete ohne ausdrückliche Zustimmung des Nutzers installieren.
- **Idiomatische Änderungen:** TypeBox für Schemas, Signals für Angular-Zustand und Feathers-Resolver für Datenschutz verwenden.
- **Kommentare:** Nur für das *Warum* komplexer Logik — nicht für das *Was*.
- **Proaktivität:** Wenn eine Schema-Änderung eine DB-Migration oder ein Typ-Update erfordert, dies erwähnen oder einplanen.

---

# 2. Tech-Stack & Architektur

- **Monorepo:** Nx (Node.js). Alle Befehle via `nx` ausführen.
- **Backend (API):** FeathersJS v5 (Dove), TypeBox-Schemas, Koa-Transport.
  - **Datenbank:** Hybrid-Adapter-Pattern — Edge: SQLite (Knex), Cloud: MongoDB (Mongoose).
  - **Regel:** Niemals rohe SQL- oder Mongo-Queries in Services. Feathers Adapter API verwenden.
- **Frontend:** Angular (neueste Version), ausschließlich Standalone-Komponenten, Signals für State.
- **Geteilter Code:** `libs/domains/[domain-name]` — Apps importieren aus Libs, nie umgekehrt.
  - Import-Pfad: `@panary-core/[domain]/domain`

---

# 3. Primäre Arbeitsabläufe

## Software-Engineering-Aufgaben

1. **Verstehen:** Anfrage analysieren. Relevante Schemas oder Services suchen. `package.json` auf Abhängigkeiten prüfen.
2. **Planen:** Fundierten Plan erstellen. Prüfen, ob Feature zu „Core" oder „Enterprise" gehört.
3. **Implementieren:** Schema → Service → UI. Verfügbare Tools verwenden.
4. **Prüfen:** `nx lint` und `nx test` für das betroffene Projekt ausführen.

## Generatoren

**Keine Dateien manuell erstellen, wenn ein Generator existiert.**

```bash
# Domänenbibliothek erstellen
nx g @nx/js:lib --name=[name]-domain domains/[name] \
  --directory=libs/domains/[name]/domain \
  --bundler=tsc --unitTestRunner=vitest \
  --tags="type:domain,domain:[name]" \
  --importPath=@panary-core/[name]/domain

# FeathersJS-Service erstellen
nx g ./tools/generators/feathers-service:feathers-service [name]

# Anwendungen starten
nx serve api-edge
nx serve pos-client
```

## Neue Features / Anwendungen

1. **Anforderungen:** Prüfen, ob das Feature eine neue Domänenbibliothek (`libs/domains/...`) benötigt.
2. **Plan vorschlagen:** Ordnerstruktur und notwendige Schema-Änderungen (TypeBox) vorschlagen.
3. **Implementierung:** Mit Nx scaffolden. Ablauf: Schema → Service → UI.

---

# 4. Operative Richtlinien

- **Präzise & direkt:** Fokus auf Code und Logik. Minimale Prosa.
- **Kein Gerede:** Kein „Ich werde jetzt X tun". Direkt Plan nennen oder umsetzen.
- **Ablehnung bei Architekturverstößen:** Direkte SQL-Queries, manuelle Datei-Erstellung statt Nx-Generatoren, NgModules → ablehnen und Grund erklären.

---

# 5. Sicherheitsregeln (Kurzfassung)

→ Vollständige Regeln: `.claude/rules/security.md`

- Kritische Befehle (`rm`, `git reset`, DB-Migrationen) immer mit Auswirkungsbeschreibung ankündigen.
- API-Keys, JWTs oder Passwörter niemals loggen oder committen.
- Jeder neue FeathersJS-Service **muss** `authenticate('jwt')`, `authorize()` und `multiTenancy()` in `around.all` registrieren.
- Sensitive Felder über `resolveData`/`resolveExternal` schützen — niemals manuell filtern.

---

# 6. Tool-Strategie

- **Parallelität:** Wenn möglich mehrere Dateien gleichzeitig suchen.
- **Kontext:** Für Datenbanktyp `apps/api-edge/src/app.ts` oder `system`-Konfiguration prüfen, nie raten.
- **Absolute Pfade:** Bei Tool-Verwendung immer absolute Pfade nutzen.

---

# 7. Nx-Richtlinien

- Aufgaben (build, lint, test, e2e) immer via `nx` ausführen — nie das unterliegende Tool direkt aufrufen.
- Den Nx MCP-Server und seine Tools nutzen, wenn verfügbar.
- Für Repository-Fragen: `nx_workspace`-Tool. Für Projektanalyse: `nx_project_details`-Tool.
- Bei Nx-Konfigurationsfragen `nx_docs`-Tool nutzen — keine Annahmen treffen.
- Nx-Plugin-Best-Practices unter `node_modules/@nx/<plugin>/PLUGIN.md` prüfen.
