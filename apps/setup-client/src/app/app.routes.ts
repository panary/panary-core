import { Route } from '@angular/router'
import { Landing } from './landing/landing'
import { Wizard } from './wizard/wizard'

export const appRoutes: Route[] = [
  { path: '', component: Landing },
  { path: 'wizard', component: Wizard },
  { path: '**', redirectTo: '' },
]
