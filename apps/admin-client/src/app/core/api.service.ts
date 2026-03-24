import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { lastValueFrom } from 'rxjs'

const API_URL = 'http://localhost:3030'

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

  async create<T>(service: string, data: Partial<T>): Promise<T> {
    return lastValueFrom(this.http.post<T>(`${API_URL}/${service}`, data))
  }

  async patch<T>(service: string, id: string, data: Partial<T>): Promise<T> {
    return lastValueFrom(this.http.patch<T>(`${API_URL}/${service}/${id}`, data))
  }

  async remove<T>(service: string, id: string): Promise<T> {
    return lastValueFrom(this.http.delete<T>(`${API_URL}/${service}/${id}`))
  }

  /** Feathers-kompatible Query-Serialisierung (verschachtelte Objekte wie $sort) */
  private buildQueryString(query: Record<string, any>, prefix = ''): string {
    const parts: string[] = []
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      const fullKey = prefix ? `${prefix}[${key}]` : key
      if (typeof value === 'object' && !Array.isArray(value)) {
        parts.push(this.buildQueryString(value, fullKey))
      } else {
        parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`)
      }
    }
    return parts.filter(Boolean).join('&')
  }
}
