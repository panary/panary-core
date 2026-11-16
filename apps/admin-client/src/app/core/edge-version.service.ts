import { HttpClient } from '@angular/common/http'
import { inject, Injectable } from '@angular/core'
import { lastValueFrom } from 'rxjs'
import { API_BASE_URL } from './api-base-url'

/**
 * Version des laufenden Edge-Servers aus dem öffentlichen `GET /health` (core#1354).
 *
 * Genutzt von der Login-Seite (ohne Anmeldung) und der Edge-Statuszeile. Das Dashboard liest
 * `/health` weiter selbst, weil es die ganze Systeminfo braucht. Bewusst nicht im
 * `ConnectionService`: der liegt in `libs/shared/data-access` und wird auch vom POS genutzt.
 *
 * Der Query-Parameter `t` umgeht einen Browser-Cache, damit ein normales Neuladen nach einem
 * Edge-Update die neue Version zeigt; die Health-Middleware vergleicht nur `ctx.path` und
 * ignoriert ihn. Kein `Cache-Control`-Request-Header: der löst im Dev-Setup (4202 → 3030) einen
 * CORS-Preflight aus.
 */
@Injectable({ providedIn: 'root' })
export class EdgeVersionService {
  private readonly http = inject(HttpClient)

  /** Die Version, oder `null`, wenn `/health` nicht antwortet oder kein `version` liefert. */
  async load(): Promise<string | null> {
    return (await this.loadInfo())?.version ?? null
  }

  /**
   * Version und die zuletzt von der Cloud gemeldeten Mindestversionen (core#1440), oder `null`, wenn `/health`
   * nicht antwortet oder keine Version liefert. Die Mindestversionen sind `null`, solange der Edge keine kennt;
   * sie stehen dort auch bei Funkstille zur Cloud (letzter Stand).
   */
  async loadInfo(): Promise<EdgeVersionInfo | null> {
    const health = await lastValueFrom(
      this.http.get<{ version?: unknown; requiredEdgeMinVersion?: unknown; requiredPosMinVersion?: unknown }>(
        `${API_BASE_URL}/health?t=${Date.now()}`,
      ),
    ).catch(() => null)
    const version = text(health?.version)
    if (version === null) return null
    return {
      version,
      requiredEdgeMinVersion: text(health?.requiredEdgeMinVersion),
      requiredPosMinVersion: text(health?.requiredPosMinVersion),
    }
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

export interface EdgeVersionInfo {
  version: string
  requiredEdgeMinVersion: string | null
  requiredPosMinVersion: string | null
}
