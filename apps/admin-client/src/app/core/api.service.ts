import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { lastValueFrom } from 'rxjs'

const API_URL = window.location.origin

export interface Paginated<T> {
  total: number
  limit: number
  skip: number
  data: T[]
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient)

  async find<T>(service: string, query: Record<string, any> = {}): Promise<Paginated<T>> {
    const params = this.buildQueryString(query)
    return lastValueFrom(this.http.get<Paginated<T>>(`${API_URL}/${service}?${params}`))
  }

  async get<T>(service: string, id: string): Promise<T> {
    return lastValueFrom(this.http.get<T>(`${API_URL}/${service}/${id}`))
  }

  /**
   * GET auf einen Service, der ein einzelnes Objekt liefert (kein Paginated-
   * Wrapper) — z.B. Custom-Computed-Services wie `device-connections`
   * ({ online, total, connectedDeviceIds }).
   */
  async getResource<T>(service: string, query: Record<string, any> = {}): Promise<T> {
    const params = this.buildQueryString(query)
    const qs = params ? `?${params}` : ''
    return lastValueFrom(this.http.get<T>(`${API_URL}/${service}${qs}`))
  }

  async create<T>(service: string, data: Partial<T>): Promise<T> {
    return lastValueFrom(this.http.post<T>(`${API_URL}/${service}`, data))
  }

  async patch<T>(service: string, id: string, data: Partial<T>): Promise<T> {
    return lastValueFrom(this.http.patch<T>(`${API_URL}/${service}/${id}`, data))
  }

  async remove<T>(service: string, id: string): Promise<T> {
    return lastValueFrom(this.http.delete<T>(`${API_URL}/${service}/${id}`))
  }

  // Custom-Methods (Feathers v5): werden ueber den X-Service-Method-Header
  // geroutet, NICHT ueber URL-Pfad-Suffix. Ohne Header degradiert ein Aufruf wie
  // POST /service/methodName auf service.create() mit Path-Suffix als id und
  // schlaegt mit Schema-Validation oder unerwartetem Hook-Verhalten fehl.
  async customMethod<T>(
    service: string,
    method: string,
    data: Record<string, unknown> = {},
  ): Promise<T> {
    return lastValueFrom(
      this.http.post<T>(`${API_URL}/${service}`, data, {
        headers: { 'X-Service-Method': method },
      }),
    )
  }

  /** Feathers-kompatible Query-Serialisierung (verschachtelte Objekte und Arrays wie $sort, $select) */
  private buildQueryString(query: Record<string, any>, prefix = ''): string {
    const parts: string[] = []
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      const fullKey = prefix ? `${prefix}[${key}]` : key
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          parts.push(`${encodeURIComponent(fullKey)}[${i}]=${encodeURIComponent(String(value[i]))}`)
        }
      } else if (typeof value === 'object') {
        parts.push(this.buildQueryString(value, fullKey))
      } else {
        parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`)
      }
    }
    return parts.filter(Boolean).join('&')
  }
}
