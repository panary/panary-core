import { CanDeactivateFn } from '@angular/router'
import { ProductDetailsComponent } from '@panary/apps/admin/products/feature-management'

export const canDeactivateGuard: CanDeactivateFn<unknown> = (component, currentRoute, currentState, nextState) => {
  if (component instanceof ProductDetailsComponent) {
    return component.canDeactivate()
  }

  return true
}
