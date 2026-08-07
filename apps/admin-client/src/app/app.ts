import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { type CloudBannerActionKind, CloudStatusBannerService, LanguageService } from '@panary/shared/data-access'
import { CloudStatusBannerComponent } from '@panary/shared/ui-cloud-status'

import { ConfirmDialogComponent } from './core/confirm-dialog'
import { EmergencyOverrideService } from './core/emergency-override.service'
import { formatApiError } from './core/error-helper'
import { OfflineOverrideService } from './core/offline-override.service'

@Component({
  imports: [RouterOutlet, CloudStatusBannerComponent, ConfirmDialogComponent, TranslateModule],
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Genau EIN priorisierter Cloud-Status-Banner (positioniert sich selbst).
         Offline-Modus- und Notfall-Modus-Aktion sind im Admin freigeschaltet
         (RBAC: cloud-connection); der POS bekommt beide bewusst nicht. -->
    <lib-cloud-status-banner
      [banner]="banner()"
      [enableOfflineModeAction]="true"
      [enableEmergencyOverrideAction]="true"
      (action)="onBannerAction($event)"
    />

    @if (emergencyError(); as err) {
      <!--
        Der Beenden-Button ist bewusst NICHT auf die Rolle gegatet: die
        Berechtigung kennt neben der Rolle auch additive Pro-User-Grants, ein
        Rollen-Check im Client waere also schlicht falsch. Stattdessen wird der
        Backend-Fehler gezeigt — vorher verschluckte ein leerer catch das 403
        eines TENANT_MANAGER vollstaendig.
      -->
      <div
        class="fixed top-20 left-1/2 -translate-x-1/2 z-[1000] max-w-[min(92vw,40rem)]
                  rounded-xl border border-red-200 dark:border-red-800
                  bg-red-50/95 dark:bg-red-900/90 px-4 py-2.5 shadow-md
                  flex items-start gap-2.5"
        role="alert"
      >
        <span
          class="material-symbols-outlined text-[18px] leading-none mt-0.5 text-red-700 dark:text-red-200"
          aria-hidden="true"
          >error</span
        >
        <p class="text-sm text-red-800 dark:text-red-200 flex-1">{{ err }}</p>
        <button
          type="button"
          (click)="emergencyError.set(null)"
          class="shrink-0 text-xs font-medium text-red-800 dark:text-red-200 underline"
        >
          {{ 'COMMON.CLOSE' | translate }}
        </button>
      </div>
    }

    @if (confirmEndEmergency()) {
      <app-confirm-dialog
        [title]="'CLOUD_MANAGED.EMERGENCY_END' | translate"
        [message]="'CLOUD_MANAGED.EMERGENCY_END_CONFIRM' | translate"
        [confirmLabel]="'COMMON.CONFIRM' | translate"
        [dismissLabel]="'COMMON.CANCEL' | translate"
        (confirmed)="onEndEmergencyConfirmed()"
        (dismissed)="confirmEndEmergency.set(false)"
        (cancelled)="confirmEndEmergency.set(false)"
      />
    }

    <router-outlet />
  `,
})
export class App {
  // Eager-Init: translate.use() muss vor Login laufen
  protected lang = inject(LanguageService)
  #bannerService = inject(CloudStatusBannerService)
  #offlineOverride = inject(OfflineOverrideService)
  #emergencyOverride = inject(EmergencyOverrideService)

  protected readonly banner = this.#bannerService.activeBanner
  protected readonly confirmEndEmergency = signal(false)
  protected readonly emergencyError = signal<string | null>(null)

  protected onBannerAction(kind: CloudBannerActionKind): void {
    if (kind === 'reload') {
      window.location.reload()
      return
    }
    if (kind === 'end-emergency-override') {
      // Bestaetigen, weil danach keine lokalen Drucker-Aenderungen mehr
      // angenommen werden — bei laufendem Cloud-Ausfall eine folgenreiche
      // Entscheidung.
      this.confirmEndEmergency.set(true)
      return
    }
    // activate-offline-mode
    void this.#offlineOverride.activate()
  }

  protected async onEndEmergencyConfirmed(): Promise<void> {
    this.confirmEndEmergency.set(false)
    this.emergencyError.set(null)
    try {
      await this.#emergencyOverride.setActive(false)
    } catch (err) {
      // Ohne diese Meldung ist ein 403 (fehlendes CLOUD_CONNECTION: MANAGE) von
      // einem haengenden Request nicht unterscheidbar — der Dialog schliesst,
      // der Banner bleibt, und der Nutzer weiss nicht warum.
      this.emergencyError.set(formatApiError(err))
    }
  }
}
