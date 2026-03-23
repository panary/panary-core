import { ActivatedRouteSnapshot, CanActivateFn, RouterStateSnapshot } from '@angular/router'
import { inject } from '@angular/core'
import { AuthService } from '../services/auth.service'
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar'

export const preventAccessGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): boolean => {
  const authService: AuthService = inject(AuthService)
  const matSnackBar: MatSnackBar = inject(MatSnackBar)

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

  //#region Initializing the popup control (Material Snack Bar)
  const snackBarConfig: MatSnackBarConfig<any> = new MatSnackBarConfig()
  // snackBarConfig.verticalPosition = 'top'                // Positioning the snack bar popup
  snackBarConfig.duration = 6000 // Snack bar popup display duration
  snackBarConfig.panelClass = ['bg-red-600', 'text-white'] // Snack bar popup applied class for styling
  //#endregion

  matSnackBar.open('Sie sind nicht berechtigt, auf diese Seite zuzugreifen!', 'Schließen', snackBarConfig)

  return false
}
