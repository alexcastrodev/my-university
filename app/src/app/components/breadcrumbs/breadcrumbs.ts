import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';

export interface BreadcrumbItem {
  name: string;
  path: string;
}

@Component({
  selector: 'app-breadcrumbs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './breadcrumbs.html',
  styleUrl: './breadcrumbs.css',
})
export class Breadcrumbs {
  /** Home is implicit — pass the trail after it, matching SeoTags.breadcrumbs. */
  items = input<BreadcrumbItem[]>([]);
}
