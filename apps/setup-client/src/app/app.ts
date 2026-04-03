import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { RouterModule } from '@angular/router'
import { TranslateService } from '@ngx-translate/core'
import { ThemeService } from './theme.service'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly translate = inject(TranslateService)

  constructor() {
    // ThemeService initialisieren, damit der effect() den Dark-Mode anwendet
    inject(ThemeService)

    this.translate.addLangs(['en', 'de', 'tr'])
    this.translate.setDefaultLang('en')
    this.translate.use('en')
  }
}
