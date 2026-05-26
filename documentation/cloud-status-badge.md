---
title: Cloud-Status-Badge — Sync-Alter + Token-Ablauf (POS + Admin)
date: 2026-05-16
category: Feature
domains: [cloud-connection, shared/ui]
status: superseded
---

> **⚠️ Abgelöst (2026-05-27):** Die hier beschriebenen separaten Sync-/Token-Badges
> (`<lib-cloud-status-badges>`) wurden durch das **priorisierte Einzel-Banner-System**
> ersetzt — es ist nur noch genau ein Banner sichtbar (höchste Gewichtung gewinnt).
> Siehe [cloud-status-banner-priorisierung.md](cloud-status-banner-priorisierung.md).
> Dieses Dokument bleibt als Historie der ursprünglichen Badge-Lösung erhalten.

# Cloud-Status-Badge — Sync-Alter + Token-Ablauf

## Context

Heute zeigt der POS-Client zwei schwebende Top-Center-Badges in
`apps/pos-client/src/app/app.ts`:

- **Rot — "OFFLINE"** (`fixed top-3`) bei `ConnectionService.connectionState().status ∈ {'disconnected','error'}`
- **Amber — "Cloud-Verbindung getrennt — bitte neu pairen"** (`fixed top-14`)
  bei `cloudNeedsRePairing()` (Edge-Token serverseitig abgelaufen/widerrufen)

Es fehlen **proaktive Warnungen**, bevor es zu spät ist:

| Trigger | Heutiger Zustand | Gewünscht |
|---|---|---|
| **Letzter erfolgreicher Sync länger her als Schwelle** | Keine UI-Anzeige; Operator merkt erst beim nächsten Fehler, dass nichts mehr fließt | Schwebende Badge: gelb ab WARN, rot ab CRIT |
| **Edge-Token läuft bald ab** | UI zeigt erst nach Ablauf "neu pairen" | Schwebende Badge mit Countdown: "Token läuft in 18 h ab" / "Token läuft in 22 min ab" |

**Im Admin-Client** zeigt das Dashboard (`apps/admin-client/src/app/features/dashboard/dashboard.ts`) bereits eine `pairingStatus`-Pille. Es fehlen die zwei neuen Hinweise dort genauso.

Im POS-Client ist die existierende `fixed top-*`-Badge das Vorbild — die neue Badge soll **dieselbe Optik** haben (z.B. `fixed top-25` als dritte Reihe), damit das Bedienpersonal in beiden Apps ein einheitliches Pattern sieht.

## Datenquellen (existieren bereits)

| Feld | Wo | Wer schreibt |
|---|---|---|
| `lastSyncAt` (ISO-Datum) | `cloud-connection`-Tabelle (Edge SQLite) | Cloud-Sync-Scheduler im Edge bei erfolgreichem Sync |
| `lastTokenErrorAt`, `tokenErrorReason` | `cloud-connection` (Edge SQLite) | Sync-Scheduler bei 401/`token-expired` |
| `tokenExpiresAt` (ISO-Datum) | `cloud-edge`-Collection (Cloud MongoDB) | Cloud beim Pairing-Code-Generieren |
| `pairingStatus` | `cloud-connection` (Edge SQLite) | Sync-Scheduler |

**Problem**: `tokenExpiresAt` lebt nur in der Cloud. Wir brauchen die Information am **Edge** (damit POS und Admin sie sehen können, ohne Cloud-Roundtrip pro Render).

**Lösung**: Beim Bootstrap und nach jedem erfolgreichen Sync den `tokenExpiresAt`-Wert von der Cloud spiegeln auf ein neues Edge-Feld `cloud-connection.edgeTokenExpiresAt` (ISO-Datum, optional). Wenn die Cloud das Datum kennt, kennt es der Edge auch.

## Schema-Änderung (Edge)

**Datei:** `libs/domains/cloud-connection/domain/src/lib/cloud-connection.schema.ts`

Neues Feld:

```typescript
edgeTokenExpiresAt: Type.Optional(Type.String({ format: 'date-time' }))
```

Migration (Knex): `apps/api-edge/migrations/<ts>_add_edge_token_expires_at.ts`
mit `table.string('edgeTokenExpiresAt').nullable()`.

## Backend-Anpassungen (Edge)

### Cloud-Sync-Scheduler

**Datei:** `apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts`

Bei erfolgreichem Sync zusätzlich den `cloud-edge`-Datensatz (Cloud-Seite) abrufen und `tokenExpiresAt` → lokales `cloud-connection.edgeTokenExpiresAt` schreiben.

### `/health`-Endpoint

**Datei:** `apps/api-edge/src/services/health/health.ts`

Heute liefert das `/health` `pairingStatus` und `tokenErrorReason`. Erweitern um zwei zusätzliche Felder:

```typescript
{
  pairingStatus,
  tokenErrorReason,
  lastSyncAt,           // NEU — ISO-String oder null
  edgeTokenExpiresAt,   // NEU — ISO-String oder null
}
```

Damit kann der POS-Client das polling-frei via `connection.service.ts#healthPoll` (existiert bereits) konsumieren — kein RBAC nötig.

### `cloud-connection`-Service: Resolver

Der Wert `edgeTokenExpiresAt` wird nur für RBAC-berechtigte Admin-Clients über `cloud-connection.get()` zurückgegeben — der POS-Client kommt über `/health`.

## Frontend — Service-Erweiterung

**Datei:** `libs/shared/data-access/src/lib/services/connection.service.ts`

Zwei neue Signals + zwei neue Computeds:

```typescript
// Rohwerte aus /health
readonly #lastSyncAt = signal<string | null>(null)
readonly #edgeTokenExpiresAt = signal<string | null>(null)

// 60-Sek-Tick — erzwingt Re-Compute der "Wie alt"-Werte ohne Polling-Roundtrip
readonly #tick = signal(0)

constructor() {
  setInterval(() => this.#tick.update(v => v + 1), 60_000)
}

readonly syncStaleness = computed<{ ageSec: number | null; level: 'ok' | 'warn' | 'crit' }>(() => {
  this.#tick() // Re-Compute alle 60s erzwingen
  const ts = this.#lastSyncAt()
  if (!ts) return { ageSec: null, level: 'crit' } // Noch nie gesynct
  const ageSec = Math.floor((Date.now() - Date.parse(ts)) / 1000)
  return {
    ageSec,
    level: ageSec > 30 * 60 ? 'crit' : ageSec > 5 * 60 ? 'warn' : 'ok',
  }
})

readonly tokenExpiry = computed<{ remainingSec: number | null; level: 'ok' | 'warn' | 'crit' }>(() => {
  this.#tick()
  const ts = this.#edgeTokenExpiresAt()
  if (!ts) return { remainingSec: null, level: 'ok' }
  const remainingSec = Math.floor((Date.parse(ts) - Date.now()) / 1000)
  return {
    remainingSec,
    level: remainingSec < 3600 ? 'crit' : remainingSec < 24 * 3600 ? 'warn' : 'ok',
  }
})
```

**Schwellwerte** (initial; sollten konfigurierbar werden, sobald ein User echte Werte aus dem Betrieb meldet):

| Trigger | OK | WARN | CRIT |
|---|---|---|---|
| Sync-Alter | < 5 min | 5–30 min | > 30 min |
| Token-Restlaufzeit | > 24 h | 1–24 h | < 1 h (oder schon abgelaufen) |

**Healthpoll**: Setze `#lastSyncAt` und `#edgeTokenExpiresAt` aus jedem `/health`-Response.

## Frontend — Geteilte UI-Komponente

**Neue Lib:** `libs/shared/ui-cloud-status/`

```bash
nx g @nx/angular:lib --name=ui-cloud-status \
  --directory=libs/shared/ui-cloud-status \
  --standalone --tags="type:ui,scope:shared"
```

**Komponente:** `<lib-cloud-status-badges>`

Zustandslos — bekommt `syncStaleness()` und `tokenExpiry()` als Inputs und rendert pro Trigger eine eigene schwebende Badge (oder gar nichts, wenn beide auf `level === 'ok'`).

```typescript
@Component({
  selector: 'lib-cloud-status-badges',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Sync-Alter — gleiche Optik wie OFFLINE-Badge, aber gelb/rot je nach Level -->
    @if (sync().level !== 'ok') {
      <div [class]="positionClass()"
           class="fixed left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-1.5 px-3 py-1
                  backdrop-blur rounded-full text-xs font-semibold border shadow-sm"
           [class.bg-amber-100/95]="sync().level === 'warn'"
           [class.text-amber-800]="sync().level === 'warn'"
           [class.border-amber-300]="sync().level === 'warn'"
           [class.bg-red-100/95]="sync().level === 'crit'"
           [class.text-red-700]="sync().level === 'crit'"
           [class.border-red-200]="sync().level === 'crit'">
        <span class="material-symbols-outlined text-[14px]">cloud_sync</span>
        {{ syncLabel() }}
      </div>
    }
    <!-- Token-Ablauf — eigene Reihe darunter -->
    @if (token().level !== 'ok') {
      <div class="fixed top-25 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-1.5 px-3 py-1 …"
           …>
        <span class="material-symbols-outlined text-[14px]">key</span>
        {{ tokenLabel() }}
      </div>
    }
  `,
})
export class CloudStatusBadgesComponent {
  sync = input.required<SyncStaleness>()
  token = input.required<TokenExpiry>()

  // Labels: "Letzter Sync vor 12 min" / "Token läuft in 18 h ab" / "Token abgelaufen"
  // mit i18n-Schlüsseln COMMON.SYNC_AGE_MIN, COMMON.SYNC_AGE_HOUR, COMMON.TOKEN_EXPIRES_IN
}
```

**Positionierung im POS** (drei mögliche Reihen — bestehende `top-3` und `top-14` bleiben Vorrang):

- `top-3` — OFFLINE (existiert)
- `top-14` — RE-PAIRING (existiert)
- `top-25` — NEU: Sync-Alter
- `top-36` — NEU: Token-Ablauf

Im Admin: dasselbe Komponenten-Markup im Dashboard-Layout — entweder als schwebende Badges (genauso wie POS) oder als eingelassene Status-Karte. Empfehlung: **schwebende Badges**, damit die Optik 1:1 identisch ist.

### Konsumenten

**1) POS-Client** (`apps/pos-client/src/app/app.ts`):

```html
<lib-cloud-status-badges
  [sync]="syncStaleness()"
  [token]="tokenExpiry()"
/>
```

**2) Admin-Client** — analog, in `apps/admin-client/src/app/layouts/app-layout.html` (oder dem authentifizierten Shell, das jede Page wrappt), damit der Hinweis auch auf der Dashboard-Page direkt sichtbar ist.

### i18n-Keys

`apps/pos-client/src/assets/i18n/{de,en,tr}.json`:

```json
{
  "CLOUD_STATUS": {
    "SYNC_AGE_MIN":  "Letzter Cloud-Sync vor {{minutes}} min",
    "SYNC_AGE_HOUR": "Letzter Cloud-Sync vor {{hours}} h",
    "SYNC_NEVER":    "Noch kein Cloud-Sync",
    "TOKEN_EXPIRES_IN_HOURS":   "Token läuft in {{hours}} h ab",
    "TOKEN_EXPIRES_IN_MINUTES": "Token läuft in {{minutes}} min ab",
    "TOKEN_EXPIRED": "Token abgelaufen — neu pairen"
  }
}
```

## Verifikation

- Unit-Tests für `syncStaleness`/`tokenExpiry`-Computeds (3 Levels × 4 Fixture-Werte)
- E2E (manuell):
  1. `pnpm dev` starten
  2. Im POS warten — keine Sync-Badge (Sync läuft)
  3. Edge-Sync deaktivieren (`cloud-connection.patch(_id, { syncEnabled: false })`)
  4. Nach ~6 min → gelbe Sync-Age-Badge erscheint
  5. Nach 31 min → rote Sync-Age-Badge
  6. `cloud-connection.patch(_id, { edgeTokenExpiresAt: <in 23h> })` → gelbe Token-Badge
  7. `… edgeTokenExpiresAt: <in 30 min> }` → rote Token-Badge
- Admin: gleiche Schritte, Dashboard auf
- Schwellwerte über `?syncWarnSec=…&syncCritSec=…&tokenWarnSec=…&tokenCritSec=…`-URL-Override für Tester (optional)

## Akzeptanzkriterien

- [ ] `cloud-connection`-Schema hat optionales `edgeTokenExpiresAt`
- [ ] Knex-Migration in `apps/api-edge/migrations/`
- [ ] `/health` liefert `lastSyncAt` und `edgeTokenExpiresAt`
- [ ] Cloud-Sync-Scheduler spiegelt `cloud-edge.tokenExpiresAt` → `cloud-connection.edgeTokenExpiresAt`
- [ ] `ConnectionService` hat `syncStaleness()` und `tokenExpiry()` als Computeds
- [ ] `<lib-cloud-status-badges>` rendert pro Trigger genau dann, wenn `level !== 'ok'`
- [ ] POS- und Admin-App nutzen dieselbe Komponente; visuelle Konsistenz prüfbar
- [ ] i18n-Schlüssel in `de`, `en`, `tr` vorhanden
- [ ] Doku in `documentation/INDEX.md` referenziert

## Dateien — zur Übersicht

**Backend:**
- `libs/domains/cloud-connection/domain/src/lib/cloud-connection.schema.ts` — Feld
- `apps/api-edge/migrations/<ts>_add_edge_token_expires_at.ts` — Migration
- `apps/api-edge/src/services/health/health.ts` — `/health`-Response
- `apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts` — Spiegelung

**Frontend (Shared):**
- `libs/shared/data-access/src/lib/services/connection.service.ts` — neue Signals/Computeds + `/health`-Polling-Erweiterung
- `libs/shared/ui-cloud-status/` — neue Lib mit `<lib-cloud-status-badges>`

**Apps:**
- `apps/pos-client/src/app/app.ts` — Komponente einhängen
- `apps/admin-client/src/app/layouts/app-layout.{ts,html}` — Komponente einhängen
- `apps/pos-client/src/assets/i18n/{de,en,tr}.json` — i18n-Keys

**Doku:**
- `documentation/INDEX.md` — Eintrag in „Architektur"-Sektion
- `documentation/cloud-status-badge.md` — dieser Plan; nach Implementation auf `status: implemented` setzen
