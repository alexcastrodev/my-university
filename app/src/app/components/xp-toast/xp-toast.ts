import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { XpToastService } from '../../services/xp-toast.service';

@Component({
  selector: 'app-xp-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './xp-toast.html',
  styleUrl: './xp-toast.css',
})
export class XpToast {
  protected toastService = inject(XpToastService);
}
