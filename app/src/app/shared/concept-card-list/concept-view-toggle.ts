import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConceptViewModeService } from './concept-view-mode.service';

@Component({
  selector: 'app-concept-view-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './concept-view-toggle.html',
  styleUrl: './concept-view-toggle.css',
})
export class ConceptViewToggleComponent {
  protected readonly viewModeService = inject(ConceptViewModeService);
}
