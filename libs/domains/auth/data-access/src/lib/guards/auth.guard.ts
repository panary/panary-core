import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router'
import { AuthService } from '../services/auth.service'
import { inject } from '@angular/core'

export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean => {
  const authService: AuthService = inject(AuthService)
  const router: Router = inject(Router)

  // Determine the URL to which the user wants to navigate
  const url: string = state.url

  // Define the routes that are to be excluded
  const excludedRoutes: string[] = ['/login', '/change-password']

  // If the route is excluded, allow access
  if (excludedRoutes.includes(url)) {
    return true
  }

  // Check whether the user is logged in
  if (!authService.isLoggedIn()) {
    // User is not logged in, redirect to login page
    router.navigate(['/login'], { queryParams: { retUrl: route.url } }).then()
    return false
  }

  // Check whether the user needs to change their password
  if (authService.mustChangePassword()) {
    // User needs to change their password, redirect to the change-password page
    // Prevent redirection to /change-password to avoid a loop
    if (url !== '/reset-password') {
      router.navigate(['/reset-password']).then()
      return false
    }
  }

  // All checks passed, allow access
  return true
}
