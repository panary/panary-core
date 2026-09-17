import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import { SetupService, SetupPayload } from '../setup.service'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ThemeService } from '../theme.service'

@Component({
  selector: 'app-wizard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule],
  templateUrl: './wizard.html',
  styleUrl: './wizard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Wizard {
  private fb = inject(FormBuilder)
  private setupService = inject(SetupService)
  private translate = inject(TranslateService)
  readonly themeService = inject(ThemeService)

  // Signal State
  step = signal<number>(1)
  loading = signal<boolean>(false)
  restarting = signal<boolean>(false)
  /** i18n-Key der letzten Fehlermeldung, im Formular angezeigt. */
  submitError = signal<string | null>(null)
  mode = signal<'standalone' | 'cloud' | null>(null)
  currentLang = signal<string>(this.translate.currentLang || 'en')

  form = this.fb.group(
    {
      // Besitznachweis (#323) — steht bewusst als erstes Feld: Wer es nicht hat,
      // soll das vor dem Ausfuellen merken und nicht erst beim Absenden.
      setupToken: ['', Validators.required],
      shopName: ['', Validators.required],
      locationName: ['', Validators.required],
      businessType: ['', Validators.required],
      adminEmail: ['', [Validators.required, Validators.email]],
      adminPassword: ['', [Validators.required, Validators.minLength(8)]],
      adminPasswordConfirm: ['', [Validators.required]],
    },
    { validators: this.passwordMatchValidator },
  )

  // Werte entsprechen LocationBusinessType aus @panary/locations/domain —
  // setup-client bleibt bewusst ohne Domain-Lib-Abhängigkeit (schlankes Bundle).
  readonly businessTypeOptions = [
    { value: 'RESTAURANT_CLASSIC', labelKey: 'WIZARD.CONFIG.BUSINESS_TYPE_OPTIONS.RESTAURANT_CLASSIC' },
    { value: 'CAFE_BAKERY', labelKey: 'WIZARD.CONFIG.BUSINESS_TYPE_OPTIONS.CAFE_BAKERY' },
    { value: 'TAKEOUT_DELIVERY', labelKey: 'WIZARD.CONFIG.BUSINESS_TYPE_OPTIONS.TAKEOUT_DELIVERY' },
    { value: 'BAR_NIGHTLIFE', labelKey: 'WIZARD.CONFIG.BUSINESS_TYPE_OPTIONS.BAR_NIGHTLIFE' },
    { value: 'FOODTRUCK_STREETFOOD', labelKey: 'WIZARD.CONFIG.BUSINESS_TYPE_OPTIONS.FOODTRUCK_STREETFOOD' },
    { value: 'FINE_DINING', labelKey: 'WIZARD.CONFIG.BUSINESS_TYPE_OPTIONS.FINE_DINING' },
  ]

  passwordMatchValidator(g: any) {
    return g.get('adminPassword')?.value === g.get('adminPasswordConfirm')?.value ? null : { mismatch: true }
  }

  useLanguage(lang: string) {
    this.translate.use(lang)
    this.currentLang.set(lang)
  }

  selectMode(mode: 'standalone' | 'cloud') {
    this.mode.set(mode)
    this.nextStep()
  }

  nextStep() {
    this.step.update(s => s + 1)
  }

  prevStep() {
    this.step.update(s => s - 1)
  }

  submit() {
    if (this.form.invalid || !this.mode()) return

    this.loading.set(true)
    this.submitError.set(null)
    const formValue = this.form.getRawValue()

    // setupToken gehoert bewusst NICHT in den Payload — der Edge schreibt ihn
    // 1:1 in seine Konfigurationsdatei. Er reist als Header (setup.service.ts).
    const payload: SetupPayload = {
      mode: this.mode()!,
      shopName: formValue.shopName || '',
      locationName: formValue.locationName || '',
      businessType: formValue.businessType || '',
      adminEmail: formValue.adminEmail || '',
      adminPassword: formValue.adminPassword || undefined,
    }

    this.setupService.setup(payload, formValue.setupToken || '').subscribe({
      next: () => {
        this.loading.set(false)
        this.restarting.set(true)
        this.pollUntilReady()
      },
      error: err => {
        this.loading.set(false)
        this.submitError.set(setupErrorKey(err))
      },
    })
  }

  private pollUntilReady(maxAttempts = 15, intervalMs = 2000): void {
    let attempts = 0
    const poll = () => {
      attempts++
      fetch('/health')
        .then(res => {
          if (res.ok) {
            window.location.href = '/'
          } else {
            retry()
          }
        })
        .catch(() => retry())
    }
    const retry = () => {
      if (attempts >= maxAttempts) {
        // Timeout reached — redirect anyway, server might be up
        window.location.href = '/'
        return
      }
      setTimeout(poll, intervalMs)
    }
    // Wait one interval before first attempt (server needs time to restart)
    setTimeout(poll, intervalMs)
  }
}

/**
 * Uebersetzt die Absagen des Setup-Endpunkts in i18n-Keys.
 *
 * Vorher stand hier `alert('Setup failed: ' + err.message)` — bei einem
 * abgelehnten Token las der Betreiber "Http failure response for /api/setup:
 * 401 Unauthorized" und hatte keinen Hinweis, dass er ein Token aus dem
 * Container-Log braucht. Die Fehlerklasse ist seit #323 der Normalfall, nicht
 * mehr die Ausnahme.
 */
function setupErrorKey(err: unknown): string {
  const status = (err as { status?: number })?.status
  const reason = (err as { error?: { error?: string } })?.error?.error

  if (status === 429 || reason === 'rate_limited') return 'WIZARD.ERRORS.RATE_LIMITED'
  if (reason === 'expired') return 'WIZARD.ERRORS.TOKEN_EXPIRED'
  if (reason === 'already_used') return 'WIZARD.ERRORS.TOKEN_USED'
  if (status === 401) return 'WIZARD.ERRORS.TOKEN_INVALID'
  return 'WIZARD.ERRORS.GENERIC'
}
