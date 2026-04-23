import { InjectionToken } from '@angular/core'
import { AppConfig } from '../models/app-config.schema'

export const APP_CONFIG = new InjectionToken<AppConfig>('app.config')
