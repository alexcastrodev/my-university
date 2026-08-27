import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConceptViewModeService } from './concept-view-mode.service';
import { TranslatePipe } from '../i18n/translate.pipe';

@Component({
  selector: 'app-concept-view-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './concept-view-toggle.html',
  styleUrl: './concept-view-toggle.css',
})
export class ConceptViewToggleComponent {
  protected readonly viewModeService = inject(ConceptViewModeService);
}
