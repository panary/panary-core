import { CanDeactivateFn } from '@angular/router'

export const canDeactivateGuard: CanDeactivateFn<unknown> = (_component: unknown) => {
  return true
}
