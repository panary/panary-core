import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { QRCodeComponent } from 'angularx-qrcode'
import { RouterLink } from '@angular/router'
import { TranslateService, TranslateModule } from '@ngx-translate/core'
import { SetupService } from '../setup.service'
import { ThemeService } from '../theme.service'

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [QRCodeComponent, RouterLink, TranslateModule],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landing {
  private translate = inject(TranslateService)
  private setupService = inject(SetupService)
  readonly themeService = inject(ThemeService)

  public setupUrl = signal<string>(window.location.href)
  public ipAddress = signal<string>('')

  constructor() {
    // Fetch real IP/URL from API
    this.setupService.getSystemInfo().subscribe({
      next: info => {
        if (info && info.url) {
          this.setupUrl.set(info.url + '/wizard')
          this.ipAddress.set(info.ip)
        }
      },
      error: err => console.error('Failed to get system info', err),
    })
  }

  useLanguage(language: string) {
    this.translate.use(language)
  }
}
