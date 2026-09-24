# Review-Bericht: core-349-order-split

**Worktree:** `worktrees/core-349-order-split` · **Repo:** panary-core · **Diff:** gegen `origin/main` · **22 Dateien, 4 Commits**

---

## 1. Bestätigte Befunde

| Schwere | Datei:Zeile | Regel | Befund | Vorschlag |
|---|---|---|---|---|
| blockierend | `apps/api-edge/src/services/orders/orders.schema.ts:31` | security.md §8 „Resolver-Schutz (Sensitive Felder)“ / data-models.md | `orderDataResolver` (CREATE-Pfad) strippt `splitOff`/`splitRoundingRemainderCents` nicht, obwohl `orderDataSchema` (`libs/domains/orders/domain/src/lib/order.schema.ts:552-553`) diese Felder als erlaubt pickt (`additionalProperties:false`) und der Patch-Resolver dieselben Felder korrekt über `isOrderSplitCall` sperrt. `calculateTaxDetails` läuft zudem vor `validateData`/`resolveData` und rechnet bereits über den ungestrippten Rohwert. Jeder Aufrufer mit `orders:CREATE` (TENANT_STAFF, DEVICE_POS, DEVICE_TABLET, DEVICE_KIOSK) kann bei `orders.create` ein eigenes `splitOff` mitschicken und so den gespeicherten `taxSnapshot` von Geburt an manipulieren, ohne dass je `orders.split` gelaufen ist. | `orderDataResolver` um `splitOff: async () => undefined` und `splitRoundingRemainderCents: async () => undefined` ergänzen, oder — falls der Sync-Push-Fall (Edge→Cloud) diese Felder beim Create wirklich braucht — dieselbe `isOrderSplitCall`-Gate-Logik wie im Patch-Resolver anwenden. |
| blockierend | `apps/api-edge/src/hooks/calculate-tax-details.ts:33` | security.md §8 „Resolver-Schutz (Sensitive Felder)“ i. V. m. dem Schutzversprechen des `orderPatchResolver` | Auf dem PATCH-Pfad liest `calculateTaxDetailsOnPatch` (Zeile 33/47) das rohe `context.data.splitOff` und berechnet daraus den zu persistierenden `taxSnapshot` — **bevor** `schemaHooks.resolveData(orderPatchResolver)` (der `splitOff` für externe Aufrufer korrekt auf `undefined` setzt) überhaupt läuft (Hook-Reihenfolge in `orders.ts:209` vor `:217`). Das Feld `splitOff` selbst wird zwar am Ende gestrippt, der bereits verfälschte `taxSnapshot` bleibt aber bestehen und wird persistiert — ein Seitenkanal um den eigentlich korrekten Feldschutz herum. | In `calculateTaxDetailsOnPatch` denselben `isOrderSplitCall`-Marker prüfen, bevor `data.splitOff` als preisrelevant gilt — oder den Hook erst nach `schemaHooks.resolveData(orderPatchResolver)` ausführen, sodass nur das bereits bereinigte `context.data.splitOff` gelesen wird. |

---

## 2. Ungeprüfte Befunde

Ein Befund wurde wegen erschöpften Verifikationsbudgets (12) nicht geprüft und ist unten als **„nicht geprüft“** gekennzeichnet — er gilt nicht als bestätigt.

| Schwere | Datei:Zeile | Regel | Befund (nicht geprüft) | Vorschlag |
|---|---|---|---|---|
| hinweis | `docs/adr/0047-abrechnungskreis-als-pflichtfeld.md:1` | documentation.md §4 Nr. 3 („Querverweise setzen … beide Richtungen prüfen“) | ADR 0049 verlinkt vorwärts auf ADR 0047 und hält dort fest, dass dessen offener Punkt (Live-Berechnung im Bon-Renderer statt `taxSnapshot`) durch den Split nicht geschlossen wird — ADR 0047 selbst bekommt jedoch keinen Rückverweis auf ADR 0049. | Rückverweis von ADR 0047 auf ADR 0049 ergänzen. |

---

## 3. Geprüft ohne Befund

### datenzugriff
- code-style.md §6 — keine rohen SQL/Mongo-Writes im Service-Code: `order-split.method.ts` schreibt ausschließlich über `app.service('orders'|'receipts'|'order-references'|'order-interactions').create/patch/find`
- code-style.md §6 — Standard-Reads über Adapter-API: alle Lesezugriffe (get/find) laufen über die Feathers-Adapter-API
- code-style.md §6 — Analytics-Reads mit erzwungenem Tenant-Filter: nicht einschlägig (keine Aggregationen/Joins im Diff)
- Migration `20260924140000_orders_add_split_off.ts` — reine DDL-Migration, kein Daten-Write, kein Domain-Import
- security.md §3 `authorize()` — Custom-Method `split` explizit auf `AppAction.CREATE` gemappt, kein Fallback auf MANAGE-Only
- security.md §4 `multiTenancy()` — für Custom Methods korrekt als No-Op dokumentiert; eigene Schutzmaßnahme via `assertCallerOwnsRecord`
- security.md §8 Resolver-Schutz — `orderPatchResolver` strippt `splitOff`/`splitRoundingRemainderCents` korrekt für externe und nicht markierte interne Aufrufer (Test-Coverage vorhanden)
- Custom-Method-Registrierung — `split` korrekt in `ordersMethods` und Service-Interface registriert
- `issue-receipt.hook.ts`/`order-receipt.renderer.ts` — kein zusätzlicher DB-Zugriff eingeführt
- Domain-Logik (`order-split.ts`, `effective-line-items.ts`, `compute-order-tax.ts`, `order.schema.ts`) — ohne DB-/Treiberzugriff

### security
- security.md §2 Multi-Tenancy 3-Schichten-Modell unverändert vorhanden
- security.md §3 `authorize()`/`METHOD_TO_ACTION` — `split` explizit gemappt
- security.md §4 `multiTenancy()` — No-Op für Custom Methods bestätigt
- security.md §4 Location-Isolation (`isolateLocation:true`) geprüft — Ersatzschutz vorhanden (separater Befund zur Filial-Lücke war nicht Teil dieses Auftrags)
- security.md §5 `ensureTenantIsolation()` — App-Level-after-Hook zu spät für internen `get()`, Code kompensiert bewusst
- security.md §7 RolePermissions-Matrix — keine neue Ressource nötig, bestehende `orders`-Ressource genutzt
- security.md §9 API-Key/Geräte-Auth — keine Änderungen an Device-/API-Key-Pfaden
- `events: []` vs. `serviceEvents` (Socket-Leaks) — unverändert, kein Regressionsfund
- Rate-Limiting an Sockets — keine Regression
- Secrets im Klartext — keine gefunden
- cloud `EDGE_TOKEN_SCOPED_PATHS`-Allowlist — nicht anwendbar (reiner panary-core-Diff)
- data-models.md — neue Felder korrekt typisiert (`Type.Optional`/Union mit Null), uuidv7, Knex-Schema-Builder
- logging.md — `logger.info`/`logger.error`, keine sensitiven Felder im Log-Payload

### angular
- alle Angular-Regeln: **nicht einschlägig** — kein Angular-/UI-Code im Diff (Diff-Dateiliste gegen Angular-Pfade geprüft, kein Treffer)

### docs
- Doku-Trigger (neuer Service/Custom-Method, Schema-Änderung, komplexe Business-Logik) im selben Diff begleitet dokumentiert
- OKF-Frontmatter-Pflichtfelder auf ADR 0049 und `docs/domains/bon-split.md` vollständig
- ADR `decision: accepted`, Gliederung Problem → Entscheidung → Konsequenzen eingehalten
- ADR-Nummer 0049 kollisionsfrei (höchste auf `origin/main`: 0048)
- `docs/adr/index.md` unverändert (Generat)
- `docs/log.d/2026-09-24-349-bon-split-gegenbuchung.md` — Namensschema und Bullet-Format korrekt
- relative Links im Log-Fragment mit zusätzlichem `../`
- `docs/log.md` nicht angefasst
- `docs/domains/index.md` gepflegt, `docs/index.md` (Root) korrekt unverändert
- Feature-Flag-Pflicht — nicht einschlägig (reiner panary-core-Backend-Diff, kein panary-cloud-UI-Feature)
- Querverweise ADR 0049 → 0047/0048/0033 gesetzt und Linkziele vorhanden

### tests
- testing.md §10 (Aufzeichnungsobjekte im Test statt im `describe`-Scope) — in allen 4 neuen Spec-Dateien eingehalten
- testing.md §10.1 (geteilte Ressource statt geteilter Bindung) — `order-split.spec.ts` nutzt korrektes Zähler-Muster
- testing.md §10.2 (Integrationstests gegen geteilte Edge-SQLite) — nicht anwendbar, alle neuen Specs mocken `app.service()`
- keine pauschalen Test-Timeouts gesetzt
- vitest-Aliase/`fileParallelism` — keine „erste Spec“, keine Config-Änderung nötig
- Mutationsprobe bei Umbau geteilter Bindung — nicht anwendbar (nur Neuanlagen)
- Neue Services/Komponenten (`order-split.method.ts`, `order-split.ts`, `orders.schema.ts`-Sperre, `calculate-tax-details.ts`) jeweils mit eigener Spec-Datei abgedeckt

### korrektheit
- `createdAt` unveränderlich/serverseitig gesetzt eingehalten
- `updatedAt` nur serverseitig gesetzt eingehalten
- IDs als uuidv7-String, ISO-8601-Zeitstempel korrekt
- `authorize()`/Eigentümerschaftsprüfung (`assertCallerOwnsRecord`) vor jedem Write in `order-split.method.ts` konform zu ADR 0046
- `_id`/`tenantId`/`locationId`/`createdAt` weiterhin im `orderPatchResolver` gestrippt, unverändert
- keine rohen SQL/Mongo-Writes
- Formatter/Zeilenlänge/keine Umformatierung außerhalb des Änderungsbereichs stichprobenartig geprüft
- Positionssummen ausschließlich über Domain-Helfer (`lineItemGrossCents`, `computeOrderTax`, `effectiveLineItems`), keine eigene Summierung
- Frontmatter/ADR-Gliederung/Log-Pflege korrekt
- kein `console.log`, strukturierte `logger`-Aufrufe
- Migration ohne `@panary/*`-Import, nullable Spalten ohne Bestands-Default

Keine Dimension ist ausgefallen.

---

## Zahlen

**Bestätigt: 4 · Widerlegt: 5 · Ungeprüft: 1 (davon budgetbedingt: 1)**
