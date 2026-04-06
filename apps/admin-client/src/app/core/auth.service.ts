import { Injectable, inject, signal, computed } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Router } from '@angular/router'

const API_URL = window.location.origin
const TOKEN_KEY = 'panary_admin_token'

export interface AuthUser {
  _id: string
  loginname: string
  firstName: string
  lastName: string
  email: string
  role: string
  tenantId: string | null
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient)
  private router = inject(Router)

  #token = signal<string | null>(localStorage.getItem(TOKEN_KEY))
  #user = signal<AuthUser | null>(null)

  token = this.#token.asReadonly()
  user = this.#user.asReadonly()
  isAuthenticated = computed(() => !!this.#token())

  async login(loginname: string, password: string): Promise<boolean> {
    try {
      const result = await this.http
        .post<{ accessToken: string; user: AuthUser }>(`${API_URL}/authentication`, {
          strategy: 'local',
          loginname,
          password,
        })
        .toPromise()

      if (result?.accessToken) {
        this.#token.set(result.accessToken)
        this.#user.set(result.user)
        localStorage.setItem(TOKEN_KEY, result.accessToken)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  logout(): void {
    this.#token.set(null)
    this.#user.set(null)
    localStorage.removeItem(TOKEN_KEY)
    // replaceUrl: Browser-History-Eintrag ersetzen, damit "Zurueck" nicht zum Dashboard fuehrt
    this.router.navigate(['/login'], { replaceUrl: true })
  }

  /** Prüft gespeicherten Token beim App-Start */
  async checkAuth(): Promise<boolean> {
    const token = this.#token()
    if (!token) return false

    try {
      const result = await this.http
        .post<{ accessToken: string; user: AuthUser }>(`${API_URL}/authentication`, {
          strategy: 'jwt',
          accessToken: token,
        })
        .toPromise()

      if (result?.user) {
        this.#user.set(result.user)
        return true
      }
      this.logout()
      return false
    } catch {
      this.logout()
      return false
    }
  }
}
