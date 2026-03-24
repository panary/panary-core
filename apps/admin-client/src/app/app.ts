import { Component } from '@angular/core'
import { RouterOutlet } from '@angular/router'

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  standalone: true,
  template: '<router-outlet />',
})
export class App {}
