import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PublicationStage } from '../../models/paper.model';
import { stageLabel, stageNote } from '../../shared/paper-format';

/**
 * Where a paper stands (preprint, published...), for readers who do not know that a preprint has not been
 * reviewed. A small label on lists; with `explain`, a note in plain words. Every surface that shows a paper
 * uses it, so the context never goes missing (#201).
 */
@Component({
  selector: 'app-paper-stage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paper-stage.html',
  styleUrl: './paper-stage.css',
})
export class PaperStage {
  readonly stage = input.required<PublicationStage>();
  /** Where it appeared; shown next to a published paper so the reader sees who stands behind it. */
  readonly venue = input<string | null>(null);
  readonly explain = input(false);

  protected readonly label = stageLabel;
  protected readonly note = stageNote;
}
