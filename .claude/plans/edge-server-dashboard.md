# Plan: Edge-Server-Informationen auf dem Admin-Dashboard

## Ziel
Live-Systeminformationen des Edge-Servers auf dem Admin-Dashboard anzeigen — für Entwickler und Servicetechniker, um den Zustand der Instanz sofort einschätzen zu können.

---

## 1. Backend: `/health`-Endpoint erweitern (api-edge)

**Datei:** `apps/api-edge/src/app.ts` (bestehender `/health`-Koa-Middleware)

Der bestehende `/health`-Endpoint gibt aktuell nur `status`, `timestamp`, `uptime`, `version`, `systemMode` zurück. Wir erweitern ihn um alle relevanten Systeminformationen:

```typescript
ctx.body = {
  // Bestehend
  status: 'ok',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
  version: process.env.npm_package_version || '0.0.0',
  systemMode: app.get('system')?.mode || 'standalone',

  // NEU — Runtime
  nodeVersion: process.version,
  platform: `${os.platform()} ${os.arch()}`,
  hostname: os.hostname(),

  // NEU — Speicher
  memory: {
    rss: process.memoryUsage().rss,
    heapUsed: process.memoryUsage().heapUsed,
    heapTotal: process.memoryUsage().heapTotal,
  },

  // NEU — Netzwerk
  localIp: getLocalIpAddress(),  // bereits in status-page.ts vorhanden
  port: app.get('port'),

  // NEU — Datenbank
  database: {
    type: app.get('system')?.dbType || 'sqlite',
  },
}
```

**Hilfsfunktion `getLocalIpAddress()`** existiert bereits in `status-page.ts` — wird nach `app.ts` importiert oder in eine Utility-Datei extrahiert.

Kein neuer Service nötig — wir erweitern nur die bestehende Koa-Middleware. Bleibt public (kein JWT erforderlich).

---

## 2. Frontend: Dashboard-Komponente erweitern (admin-client)

**Datei:** `apps/admin-client/src/app/features/dashboard/dashboard.ts`

### Neues Interface

```typescript
interface EdgeServerInfo {
  status: string
  timestamp: string
  uptime: number
  version: string
  systemMode: string
  nodeVersion: string
  platform: string
  hostname: string
  memory: { rss: number; heapUsed: number; heapTotal: number }
  localIp: string
  port: number
  database: { type: string }
}
```

### Neues Signal

```typescript
edgeInfo = signal<EdgeServerInfo | null>(null)
```

### Neuer Template-Block — „Edge Server"-Karte

Unterhalb der KPIs, vor dem Ende des Containers. Ein Card-Grid mit den Systeminformationen:

```
┌─────────────────────────────────────────────────────────┐
│  Edge Server                                    🟢 OK   │
├─────────────────────────────────────────────────────────┤
│  Version      0.0.1        Node.js     v22.15.0        │
│  Uptime       2d 5h 12m    Plattform   linux arm64     │
│  Hostname     sunmi-d3     IP          192.168.1.42    │
│  Datenbank    SQLite       Modus       Standalone      │
│  RAM (RSS)    84.2 MB      Heap        52.1 / 128 MB   │
└─────────────────────────────────────────────────────────┘
```

Design: Gleicher Card-Stil wie KPIs (`bg-white dark:bg-gray-900/50 border rounded-xl`), aber volle Breite. Inneres 2-Spalten-Grid mit Key-Value-Paaren.

### Daten laden

Im bestehenden `ngOnInit()` wird der `/health`-Call bereits gemacht. Wir erweitern das Response-Interface und speichern das Ergebnis im neuen `edgeInfo`-Signal.

### Uptime-Formatierung

Hilfsfunktion `formatUptime(seconds: number): string` direkt in der Komponente — gibt z.B. `2d 5h 12m` zurück (gleiche Logik wie in `status-page.ts`).

### Bytes-Formatierung

Hilfsfunktion `formatBytes(bytes: number): string` — gibt z.B. `84.2 MB` zurück.

---

## Zusammenfassung der Änderungen

| Datei | Aktion |
|---|---|
| `apps/api-edge/src/app.ts` | `/health`-Response um System-Infos erweitern, `getLocalIpAddress` importieren |
| `apps/api-edge/src/status-page.ts` | `getLocalIpAddress()` exportieren |
| `apps/admin-client/src/app/features/dashboard/dashboard.ts` | `EdgeServerInfo`-Interface, Signal, Template-Block, Formatierungs-Hilfsfunktionen |

**Keine neuen Dateien nötig. Keine neuen Dependencies.**
