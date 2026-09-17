import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpHeaders } from '@angular/common/http'
import { Observable } from 'rxjs'

export interface SetupPayload {
  shopName: string
  locationName: string
  // Betriebstyp (PNRY-FEAT-THEME-002) — Werte entsprechen LocationBusinessType
  // aus @panary/locations/domain (setup-client bleibt bewusst domain-frei).
  businessType: string
  adminEmail: string
  adminPassword?: string // Optional depending on mode
  mode: 'standalone' | 'cloud'
}

@Injectable({
  providedIn: 'root',
})
export class SetupService {
  private http = inject(HttpClient)

  // TODO: Environment configuration for API URL
  private apiUrl = '/api'

  getSystemInfo(): Observable<any> {
    return this.http.get(`${this.apiUrl}/system-info`)
  }

  /**
   * Das Setup-Token reist im Header, nicht im Body (panary/panary-core#323):
   * Der Edge schreibt den Body 1:1 nach `panary.config.json`, ein Token im
   * Body laege danach dauerhaft im Klartext auf der Platte.
   */
  setup(data: SetupPayload, setupToken: string): Observable<any> {
    const headers = new HttpHeaders({ 'X-Setup-Token': setupToken })
    return this.http.post(`${this.apiUrl}/setup`, data, { headers })
  }
}
