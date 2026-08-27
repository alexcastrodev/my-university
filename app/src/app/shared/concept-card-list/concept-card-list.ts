import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConceptViewModeService } from './concept-view-mode.service';
import { TranslatePipe } from '../i18n/translate.pipe';

export interface ConceptCardItem {
  slug: string;
  title: string;
  summary: string;
  read: boolean;
  labUrl?: string | null;
  category?: string;
  difficulty?: string;
  readingTime?: number;
  tags?: string[];
}

@Component({
  selector: 'app-concept-card-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './concept-card-list.html',
  styleUrl: './concept-card-list.css',
})
export class ConceptCardListComponent {
  protected readonly viewModeService = inject(ConceptViewModeService);

  items = input.required<ConceptCardItem[]>();
  routeCommands = input.required<unknown[]>();

  cardLink(item: ConceptCardItem): unknown[] {
    return [...this.routeCommands(), item.slug];
  }
}
