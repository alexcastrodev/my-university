import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ChunkReloadService } from '../../services/chunk-reload.service';

@Component({
  selector: 'app-chunk-reload-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chunk-reload-toast.html',
  styleUrl: './chunk-reload-toast.css',
})
export class ChunkReloadToast {
  protected reloadService = inject(ChunkReloadService);
}
