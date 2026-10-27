import { ChangeDetectionStrategy, Component } from '@angular/core'

@Component({
  selector: 'lib-orders-feature-pos-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './orders-feature-pos-dashboard.html',
  styleUrl: './orders-feature-pos-dashboard.scss',
})
export class OrdersFeaturePosDashboard {}
