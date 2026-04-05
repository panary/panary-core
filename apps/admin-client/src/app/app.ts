import { Component, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { LanguageService } from '@panary-core/shared/data-access'

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  standalone: true,
  template: '<router-outlet />',
})
export class App {
  // Eager-Init: translate.use() muss vor Login laufen
  protected lang = inject(LanguageService)
}
