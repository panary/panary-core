import { Component, inject } from '@angular/core'
import { RouterModule } from '@angular/router'
import { TranslateService } from '@ngx-translate/core'

@Component({
  imports: [RouterModule],
  selector: 'app-root',
  template: '<router-outlet></router-outlet>',
  styles: [],
})
export class App {
  title = 'setup-client'

  private translate = inject(TranslateService)

  constructor() {
    this.translate.setDefaultLang('en')
    this.translate.use('en')
  }
}
