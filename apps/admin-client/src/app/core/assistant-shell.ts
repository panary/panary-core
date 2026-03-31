import { ChangeDetectionStrategy, Component, input, output, HostListener } from '@angular/core'

@Component({
  selector: 'app-assistant-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm"
         role="button" tabindex="0"
         (click)="closed.emit()" (keydown.enter)="closed.emit()">
      <div class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-2xl
                  max-w-xl w-full mx-4 shadow-2xl animate-[scale-in_0.15s_ease-out]
                  h-[80vh] flex flex-col"
           tabindex="-1" role="presentation"
           (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()">

        <!-- Header -->
        <div class="flex items-center gap-3 px-8 py-4 border-b border-slate-200 dark:border-gray-800">
          <div class="w-8 h-8 rounded-full bg-slate-900 dark:bg-white flex items-center justify-center shrink-0">
            <svg class="w-4 h-4 text-white dark:text-black" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
              <path d="M2 17l10 5 10-5"></path>
              <path d="M2 12l10 5 10-5"></path>
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="text-sm font-bold tracking-tight text-slate-900 dark:text-white">{{ title() }}</h2>
            <p class="text-xs text-slate-400 dark:text-gray-500">Erstellungs-Assistent</p>
          </div>
          <button type="button" (click)="closed.emit()"
            class="text-slate-400 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white
                   w-8 h-8 flex items-center justify-center rounded-lg
                   hover:bg-slate-100 dark:hover:bg-gray-800 transition text-sm">
            ✕
          </button>
        </div>

        <!-- Scrollbarer Content -->
        <div class="flex-1 overflow-y-auto px-8 py-6">
          <ng-content />
        </div>
      </div>
    </div>
  `,
  styles: `
    @keyframes scale-in {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  `,
})
export class AssistantShellComponent {
  title = input.required<string>()
  saving = input(false)
  closed = output<void>()

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closed.emit()
  }
}
