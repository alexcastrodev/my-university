import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TrackIcon } from '../track-icon/track-icon';
import { XpToastService } from '../../services/xp-toast.service';

@Component({
  selector: 'app-xp-toast',
  imports: [TrackIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './xp-toast.html',
  styleUrl: './xp-toast.css',
})
export class XpToast {
  protected toastService = inject(XpToastService);
}
