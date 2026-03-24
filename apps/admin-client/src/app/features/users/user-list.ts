import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core'
import { RouterLink } from '@angular/router'
import { ApiService } from '../../core/api.service'

interface User {
  _id: string
  loginname: string
  firstName: string
  lastName: string
  email: string
  role: string
  status: string
  isPosUser: boolean
}

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-8 space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold tracking-tight">Benutzer</h1>
        <a routerLink="/users/new"
           class="bg-white text-black font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-gray-200 transition">
          + Neuer Benutzer
        </a>
      </div>

      @if (loading()) {
        <p class="text-gray-500">Laden...</p>
      } @else if (users().length === 0) {
        <div class="text-center py-16">
          <p class="text-gray-500 text-lg">Keine Benutzer vorhanden</p>
          <p class="text-gray-600 text-sm mt-1">Erstelle den ersten POS-Benutzer</p>
        </div>
      } @else {
        <div class="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 text-left text-gray-500 text-xs uppercase tracking-wider">
                <th class="px-4 py-3">Name</th>
                <th class="px-4 py-3">Login</th>
                <th class="px-4 py-3">Rolle</th>
                <th class="px-4 py-3">POS</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              @for (user of users(); track user._id) {
                <tr class="border-b border-gray-800/50 hover:bg-gray-800/30 transition">
                  <td class="px-4 py-3 font-medium">{{ user.firstName }} {{ user.lastName }}</td>
                  <td class="px-4 py-3 text-gray-400">{{ user.loginname }}</td>
                  <td class="px-4 py-3">
                    <span class="text-xs px-2 py-0.5 rounded-full border border-gray-700 text-gray-300">
                      {{ formatRole(user.role) }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    @if (user.isPosUser) {
                      <span class="text-green-400 text-xs">Ja</span>
                    } @else {
                      <span class="text-gray-600 text-xs">Nein</span>
                    }
                  </td>
                  <td class="px-4 py-3">
                    <span [class]="user.status === 'ACTIVE' ? 'text-green-400' : 'text-gray-500'" class="text-xs">
                      {{ user.status }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <a [routerLink]="['/users', user._id]"
                       class="text-gray-500 hover:text-white text-xs transition">Bearbeiten</a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class UserListComponent implements OnInit {
  private api = inject(ApiService)

  users = signal<User[]>([])
  loading = signal(true)

  async ngOnInit() {
    try {
      const result = await this.api.find<User>('users', { $limit: 100 })
      this.users.set(result.data)
    } catch (e) {
      console.error('Fehler beim Laden der Benutzer:', e)
    }
    this.loading.set(false)
  }

  formatRole(role: string): string {
    const map: Record<string, string> = {
      'platform:owner': 'Plattform-Admin',
      'platform:admin': 'Admin',
      'tenant:owner': 'Inhaber',
      'tenant:manager': 'Manager',
      'tenant:staff': 'Mitarbeiter',
    }
    return map[role] || role
  }
}
