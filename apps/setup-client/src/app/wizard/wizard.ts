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
  mode = signal<'standalone' | 'cloud' | null>(null)
  currentLang = signal<string>(this.translate.currentLang || 'en')

  form = this.fb.group(
    {
      shopName: ['', Validators.required],
      adminEmail: ['', [Validators.required, Validators.email]],
      adminPassword: ['', [Validators.required, Validators.minLength(8)]],
      adminPasswordConfirm: ['', [Validators.required]],
    },
    { validators: this.passwordMatchValidator },
  )

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
    const formValue = this.form.getRawValue()

    const payload: SetupPayload = {
      mode: this.mode()!, // Valid because check above
      shopName: formValue.shopName || '',
      adminEmail: formValue.adminEmail || '',
      adminPassword: formValue.adminPassword || undefined,
    }

    this.setupService.setup(payload).subscribe({
      next: () => {
        this.loading.set(false)
        this.restarting.set(true)
        this.pollUntilReady()
      },
      error: err => {
        console.error(err)
        this.loading.set(false)
        alert('Setup failed: ' + err.message)
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
