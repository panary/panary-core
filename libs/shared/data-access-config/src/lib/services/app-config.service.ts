import { inject, Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { lastValueFrom } from 'rxjs'
import { AppConfig } from '../models/app-config.schema'
import { APP_CONFIG } from '../tokens/app-config.token'

@Injectable({
  providedIn: 'root',
})
export class AppConfigService {
  private http: HttpClient = inject(HttpClient)
  private envConfig = inject(APP_CONFIG)

  private runtimeConfig: AppConfig | null = null

  async loadConfig(): Promise<void> {
    try {
      // Loads additional configuration from the server (optional)
      this.runtimeConfig = await lastValueFrom(this.http.get<AppConfig>('/assets/config.json'))
    } catch {
      console.warn('Could not load runtime config, using environment config')
    }
  }

  get apiUrl(): string {
    return this.runtimeConfig?.apiUrl || this.envConfig.apiUrl
  }

  get websocketPath(): string {
    return this.runtimeConfig?.websocketPath || this.envConfig.websocketPath
  }

  get websocketUrl(): string | undefined {
    return this.runtimeConfig?.websocketUrl || this.envConfig.websocketUrl
  }
}
