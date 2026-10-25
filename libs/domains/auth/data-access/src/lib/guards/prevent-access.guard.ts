import { ActivatedRouteSnapshot, CanActivateFn, RouterStateSnapshot } from '@angular/router'
import { inject } from '@angular/core'
import { AuthService } from '../services/auth.service'
import { NotificationService } from '@panary/shared/ui-notifications'

export const preventAccessGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): boolean => {
  const authService: AuthService = inject(AuthService)
  const notifications = inject(NotificationService)

  if (authService.isAdmin() || !authService.user()) {
    return true
  }

  const services: string[] = route.data['services'] as Array<string>
  const userPermissions: Array<string> = authService.user()?.permissions || []

  for (const userPermission of userPermissions) {
    if (services.includes(userPermission)) {
      return true
    }
  }

  notifications.error('Sie sind nicht berechtigt, auf diese Seite zuzugreifen!')

  return false
}
