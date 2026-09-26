# Panary Core – KI-Assistent-Anweisungen

Du bist ein erfahrener Software-Ingenieur und interaktiver CLI-Agent, der an "Panary Core" arbeitet — einer modernen, Offline-First POS- & ERP-Plattform. Dein Ziel ist es, eine robuste, skalierbare und saubere Architektur mit Nx, der neuesten Angular-Version (v21+) und FeathersJS v5 (Dove) aufzubauen.

## Detaillierte Regelwerke

Vor dem Arbeiten die relevanten Rules lesen:

| Datei                            | Inhalt                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `.claude/rules/security.md`      | Multi-Tenancy, Hooks (`authorize`, `multiTenancy`, `ensureTenantIsolation`), Rollen, Permissions-Matrix, Resolver |
| `.claude/rules/code-style.md`    | Prettier, TypeScript-Konventionen, Benennung, Tailwind v4, Design-System — lädt immer                             |
| `.claude/rules/testing.md`       | §10 Spec-Isolation, Test-Timeouts, Runner-Konfiguration — lädt bei `*.spec.ts`, vitest-Configs, `project.json`    |
| `.claude/rules/angular.md`       | Control Flow, Signals, Signal-Inputs/Outputs, DI via `inject()`, Standalone-Architektur                           |
| `.claude/rules/data-models.md`   | IDs (uuidv7), Datumsformat, TypeBox-Schemas, „Product First"-Prinzip, Domain-Struktur                             |
| `.claude/rules/logging.md`       | Wide Events, Canonical Log Lines, Business-Kontext, Dev-Format, Sensitive-Daten-Regeln                            |
| `.claude/rules/documentation.md` | OKF-Wiki `/docs`: Struktur, Frontmatter-Profil, ADR-Regeln, Index-/Log-Pflege, Workflows                          |

---

# 1. Kernvorgaben

- **Konventionen:** Bestehende Projektkonventionen strikt einhalten. Vor dem Schreiben von Code umliegende Dateien in `libs/domains` oder `apps/` analysieren, um Stil, Benennung und Architektur zu übernehmen.
- **Nx zuerst:** **NIEMALS** Dateien manuell erstellen, wenn ein Nx-Generator existiert. Immer prüfen, ob eine Bibliothek oder ein Service via `nx g` generiert werden soll.
- **Paketmanager:** Ausschließlich `pnpm` verwenden — niemals `npm` oder `yarn`. Pakete installieren via `pnpm add -w <paket>` (das `-w`-Flag ist für die korrekte Ausführung im Workspace-Root zwingend erforderlich).
- **Bibliotheken:** **NIEMALS** eine Bibliothek als verfügbar voraussetzen. Zuerst `package.json` prüfen. Keine neuen Pakete ohne ausdrückliche Zustimmung des Nutzers installieren.
- **Idiomatische Änderungen:** TypeBox für Schemas, Signals für Angular-Zustand und Feathers-Resolver für Datenschutz verwenden.
- **Kommentare:** Nur für das _Warum_ komplexer Logik — nicht für das _Was_.
- **Proaktivität:** Wenn eine Schema-Änderung eine DB-Migration oder ein Typ-Update erfordert, dies erwähnen oder einplanen.

---

# 2. Tech-Stack & Architektur

- **Monorepo:** Nx (Node.js). Alle Befehle via `nx` ausführen.
- **Backend (API):** FeathersJS v5 (Dove), TypeBox-Schemas, Koa-Transport.
  - **Datenbank:** Hybrid-Adapter-Pattern — Edge: SQLite (Knex), Cloud: MongoDB (Mongoose).
  - **Regel:** Schreib-Pfade (SQL-Inserts/Updates/Deletes via Knex bzw. Mongo-Writes) und Standard-Reads ausschließlich über die Feathers-Adapter-API — niemals direkt auf der DB-Connection. Komplexe Analytics-Reads (Aggregationen, Joins) dürfen direkt laufen, müssen aber den Tenant-Filter (`WHERE tenantId = ?`/`$match: { tenantId }`) als ersten Schritt erzwingen. Vollständige Regel siehe `.claude/rules/code-style.md` §6.
- **Frontend:** Angular (neueste Version), ausschließlich Standalone-Komponenten, Signals für State.
- **Geteilter Code:** `libs/domains/[domain-name]` — Apps importieren aus Libs, nie umgekehrt.
  - Import-Pfad: `@panary/[domain]/domain`

## 2.1 Domain-Lib Workspace-Pattern

Jede publishable Domain hat zwei Schichten:

- **Eltern-`package.json`** in `libs/domains/[name]/` — der Workspace-Eintrag, `name: "@panary/[name]"`, mit `exports`-Map (`./domain` → `./domain/dist/index.cjs.js`) und `peerDependencies`. Wird via `pnpm nx release publish` veröffentlicht.
- **Subpackage-`package.json`** in `libs/domains/[name]/domain/` — Build-Hint für `@nx/rollup:rollup`, **niemals** Workspace-Paket. `name: "[name]-domain-internal"` (Suffix `-internal`, kein Slash, npm-spec-konform). `private: true`.

Dasselbe Pattern gilt für `libs/shared/[name]` ohne Eltern: `name: "shared-[name]-internal"`.

> **Regel:** Subpackage-`name` darf **niemals** das Slash-Pattern `@panary/X/Y` verwenden — pnpm akzeptiert das zwar, aber es kollidiert mit der `exports`-Map des Eltern-Pakets und verstößt gegen npm-Spec.

**Cross-Lib-Imports zwischen Domain-Libs** (z. B. `apikeys/domain` importiert `@panary/users/domain`):

- `external` in `project.json` rollup-Options aufnehmen.
- `peerDependencies` in der Eltern-`package.json` deklarieren (Format: `"@panary/users": "^26.4.20"`).
- `paths`-Override in der eigenen `tsconfig.lib.json` zur compiled `dist/index.d.ts` setzen (sonst TS6059 wegen rootDir-Verletzung):
  ```json
  "paths": {
    "@panary/users/domain": ["../../users/domain/dist/index.d.ts"]
  }
  ```
- `dependsOn: ["^build"]` im rollup-Build-Target sichert die Build-Reihenfolge.
- **Sobald die Lib Specs hat oder bekommt:** `vitest.config.mts` biegt jeden überschriebenen Import für die Vitest-**Laufzeit** auf die TS-Quelle um — per eigenem Resolver **vor** `nxViteTsPaths()` im `plugins`-Array. Vorlage samt Begründung: `libs/domains/apikeys/domain/vitest.config.mts`. Grund: `nxViteTsPaths()` liest den `paths`-Override aus `tsconfig.lib.json`; liegt das dist der Ziel-Lib, lädt Vitest die `.d.ts` statt Code (ohne dist fällt das Plugin auf `tsconfig.base.json` und damit auf die Quelle zurück — lokal fehlt das dist oft). Eine ng-packagr-Typdatei ist dann leer; ein rollup-dist re-exportiert `./src/index`, und das landet — gegen das Root des Testlaufs aufgelöst — in der **importierenden** Lib. Der gesuchte Export ist `undefined`: Wird er beim Laden benutzt, stirbt das Modul (#225 „Class extends value undefined", #334 „Cannot read properties of undefined"); wird er nur weitergereicht, bleibt es **still** (#393: `Type.Array(undefined)` nahm jeden Code an, nur die Ablehnungs-Tests wurden rot).
  - ⚠️ **`vitest.config.mts`, nicht `vite.config.ts`.** Vitest sucht `vitest.config.*` zuerst; liegen beide in der Lib (Normalfall), wirkt ein Fix in `vite.config.ts` nicht — und nichts meldet es.
  - **Vollständig** heißt: jeder Override-Schlüssel, den die Specs **transitiv** laden. Der Override gilt für alle Module im Testlauf, auch für Quellen fremder Libs, die über einen umgebogenen Import hereinkommen (#225: drei Einträge deckten nur die util-Specs).
  - `resolve.alias` in derselben Datei wirkt ebenso — Vites Alias-Plugin läuft vor allen `enforce: 'pre'`-Plugins. `products/data-access` leitet ihn generisch aus `tsconfig.base.json` ab und braucht damit keine gepflegte Liste. Die gegenteilige Aussage aus #334 hielt einer Nachmessung mit identischer Toolchain nicht stand (#398).
  - **Prüfen mit dist, in zwei Läufen und mit Ablehnungs-Tests** — eine Spec nur mit Positivfällen bleibt auch mit kaputtem Import grün:
    ```bash
    nx run-many -t typecheck --projects=<lib> --skip-nx-cache   # baut die dists (build → ^build)
    nx run-many -t test --projects=<lib> --skip-nx-cache
    ```
    🚨 **Nicht als ein Lauf `-t typecheck,test`:** `test` hat kein `dependsOn`, nx startet es parallel zu den Builds. Im frischen Worktree lief so `products-domain:test` vor `allergens-domain:build` — ohne Resolver 26/26 grün, nach dem Build 3/26 rot (#398). Die CI (`nx affected -t lint,test,typecheck,build`) ordnet genauso wenig: Ob dort ein dist liegt, wenn der Test startet, entscheidet die Reihenfolge, keine Abhängigkeit.

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
  --importPath=@panary/[name]/domain

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

# 6. Dokumentation (OKF-Wiki)

Projektdoku lebt im Wiki `/docs` (Open Knowledge Format v0.2). Einstieg: `docs/index.md`.
Historie: `docs/log.d/` (ein Fragment je Eintrag, zusammengesetzt via `pnpm docs:log`).
Verbindliche Regeln (Struktur, Frontmatter, ADRs, Workflows):
`.claude/rules/documentation.md` — **vor jeder Doku-Arbeit lesen**.

Kernregeln: Frontmatter-Pflichtfelder `type, title, description, tags, status, generated`;
ADRs nur in `docs/adr/` als `NNNN-<kebab>.md` mit `type: ADR`; jede Doku-Änderung pflegt
Ordner-`index.md` + `docs/index.md` + ein neues Fragment in `docs/log.d/` im gleichen Commit.

⚠️ **Zwei Ausnahmen von der Index-Pflege** — beide, weil eine gepflegte Liste die eine Datei
ist, die jeder PR am selben Ort anfasst: `docs/log.d/` hat gar keinen Index (#137), und
`docs/adr/index.md` trägt **keine ADR-Liste** — die erzeugt `pnpm docs:adr:index`, die nächste
freie Nummer `pnpm docs:adr:next` ([ADR 0025](docs/adr/0025-adr-index-generiert-statt-gepflegt.md)).

**Pflicht-Dokumentation bei:** neuem Feature/Domain, Architekturänderung (→ ADR), neuem
Service, komplexer Business-Logik, Setup/Migration, externer Integration, Breaking Changes.

**Architekturmodell (LikeC4):** Das Modell des Gesamtsystems (inkl. Edge, POS, Drucker, TSE)
liegt in `panary-cloud/docs/architecture/c4/`. Berührt eine Änderung hier ein Element, eine
Grenze, ein Fremdsystem oder einen Ablauf (Sync-Pfad, Pairing, neuer `#public`-Endpunkt,
echter TSE-Adapter), wird es mitgepflegt — der Commit landet dann in `panary-cloud`.
Regeln: `.claude/rules/documentation.md` §7.

---

# 7. Tool-Strategie

- **Parallelität:** Wenn möglich mehrere Dateien gleichzeitig suchen.
- **Kontext:** Für Datenbanktyp `apps/api-edge/src/app.ts` oder `system`-Konfiguration prüfen, nie raten.
- **Absolute Pfade:** Bei Tool-Verwendung immer absolute Pfade nutzen.

---

# 8. Nx-Richtlinien

- Aufgaben (build, lint, test, e2e) immer via `nx` ausführen — nie das unterliegende Tool direkt aufrufen.
- Den Nx MCP-Server und seine Tools nutzen, wenn verfügbar.
- Für Repository-Fragen: `nx_workspace`-Tool. Für Projektanalyse: `nx_project_details`-Tool.
- Bei Nx-Konfigurationsfragen `nx_docs`-Tool nutzen — keine Annahmen treffen.
- Nx-Plugin-Best-Practices unter `node_modules/@nx/<plugin>/PLUGIN.md` prüfen.
