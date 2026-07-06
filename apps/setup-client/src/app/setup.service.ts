import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
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

  setup(data: SetupPayload): Observable<any> {
    return this.http.post(`${this.apiUrl}/setup`, data)
  }
}
