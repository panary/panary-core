import { ChangeDetectionStrategy, Component } from '@angular/core'

@Component({
  selector: 'lib-products-feature-pos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './products-feature-pos.html',
  styleUrl: './products-feature-pos.scss',
})
export class ProductsFeaturePos {}
