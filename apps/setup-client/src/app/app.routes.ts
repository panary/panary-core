import { Route } from '@angular/router'
import { Landing } from './landing/landing'
import { Wizard } from './wizard/wizard'
import { Status } from './status/status'

export const appRoutes: Route[] = [
  { path: '', component: Landing },
  { path: 'wizard', component: Wizard },
  { path: 'status', component: Status },
  { path: '**', redirectTo: '' },
]
