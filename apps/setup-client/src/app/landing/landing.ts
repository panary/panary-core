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

  // Cloud-Pairing-Banner: wird sichtbar, wenn der Edge-Sync-Scheduler nach
  // einem 401 vom Cloud-Backend den lokalen pairingStatus auf DISCONNECTED
  // gesetzt hat (z.B. nach laengerem Standby → Token abgelaufen). Quelle ist
  // das `/health`-Feld `cloudPairingStatus`.
  public cloudNeedsRePairing = signal<boolean>(false)
  public cloudTokenErrorReason = signal<string | null>(null)

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

    // Cloud-Pairing-Status einmalig pruefen — Landing wird typischerweise nur
    // bei Erst-Setup angezeigt; nach Token-Ablauf ist es derselbe Screen, also
    // reicht ein einmaliges Probing.
    fetch('/health')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data && data.cloudPairingStatus === 'disconnected') {
          this.cloudNeedsRePairing.set(true)
          this.cloudTokenErrorReason.set(
            typeof data.cloudTokenErrorReason === 'string' ? data.cloudTokenErrorReason : null,
          )
        }
      })
      .catch(() => undefined)
  }

  useLanguage(language: string) {
    this.translate.use(language)
  }
}
