import { Component, OnInit, signal } from '@angular/core'
import { RouterOutlet } from '@angular/router'

interface PosCurrentUser {
  _id: string
  firstName: string
  lastName: string
  initials: string
}

@Component({
  selector: 'lib-shell',
  template: `
    <div id="app-frame" class="h-full w-full bg-slate-50 dark:bg-black">
      <main class="h-full w-full">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
  `],
  imports: [RouterOutlet],
})
export class AppPosShellComponent implements OnInit {
  readonly #currentUser = signal<PosCurrentUser | null>(null)

  ngOnInit(): void {
    this.loadCurrentUser()
  }

  private loadCurrentUser(): void {
    const storedUser = localStorage.getItem('pos_current_user')
    if (storedUser) {
      try {
        this.#currentUser.set(JSON.parse(storedUser))
      } catch {
        console.error('Failed to parse stored user')
      }
    }
  }
}
