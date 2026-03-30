import { Injectable, inject, signal } from '@angular/core'
import { ApiService } from './api.service'

@Injectable({ providedIn: 'root' })
export class LocationStateService {
  private api = inject(ApiService)

  locationName = signal<string>('')

  async load() {
    try {
      const result = await this.api.find<any>('locations', { $limit: 1, $select: ['name'] })
      if (result.data.length > 0) {
        this.locationName.set(result.data[0].name || '')
      }
    } catch {
      // Stiller Fehler — Titel bleibt ohne Standortnamen
    }
  }
}
