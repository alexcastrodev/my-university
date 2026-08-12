import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-concept-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './concept-actions.html',
  styleUrl: './concept-actions.css',
})
export class ConceptActions {
  read = input<boolean>(false);
  marking = input<boolean>(false);
  labUrl = input<string | null | undefined>(null);
  lockedLabel = input<string>('concept');
  markRead = output<void>();

  protected auth = inject(AuthService);

  onMarkRead(): void {
    if (!this.auth.currentUser() || this.read() || this.marking()) return;
    this.markRead.emit();
  }
}
