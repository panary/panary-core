import { ChangeDetectionStrategy, Component } from '@angular/core'

@Component({
  selector: 'lib-orders-feature-pos-active',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './orders-feature-pos-active.html',
  styleUrl: './orders-feature-pos-active.scss',
})
export class OrdersFeaturePosActive {}
