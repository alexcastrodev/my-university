import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SystemDesignConceptSummary } from '../../models/system-design-concept.model';

@Component({
  selector: 'app-concept-sidebar-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './concept-sidebar-nav.html',
  styleUrl: './concept-sidebar-nav.css',
})
export class ConceptSidebarNav {
  items = input.required<SystemDesignConceptSummary[]>();
  activeSlug = input<string | null>(null);
}
