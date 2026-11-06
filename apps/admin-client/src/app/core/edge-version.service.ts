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
    const health = await lastValueFrom(
      this.http.get<{ version?: unknown }>(`${API_BASE_URL}/health?t=${Date.now()}`),
    ).catch(() => null)
    const version = health?.version
    return typeof version === 'string' && version !== '' ? version : null
  }
}
