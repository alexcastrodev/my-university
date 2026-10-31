import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, LOCALE_ID, PLATFORM_ID, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SharedAnnotation } from '../../models/paper.model';
import { PaperAnnotationsService } from '../../services/paper-annotations.service';
import { formatPaperDate } from '../../shared/paper-format';
import { annotationKindLabel } from './annotation-item';
import { AnnotationText } from './annotation-text';

/**
 * What readers chose to share about a public paper (#187), with who wrote it. It is read in the browser, never
 * while the page is rendered on the server: the answer depends on who is looking (a share can be for chosen
 * readers) and it must never end up in a page that is cached for everyone. A paper without shares shows nothing.
 */
@Component({
  selector: 'app-shared-annotations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AnnotationText],
  templateUrl: './shared-annotations.html',
  styleUrl: './shared-annotations.css',
})
export class SharedAnnotations {
  private annotations = inject(PaperAnnotationsService);
  private browser = isPlatformBrowser(inject(PLATFORM_ID));
  private locale = inject(LOCALE_ID);

  readonly slug = input.required<string>();

  protected items = signal<SharedAnnotation[]>([]);
  protected kindLabel = annotationKindLabel;

  constructor() {
    effect(() => {
      const slug = this.slug();
      if (!this.browser) return;
      untracked(() =>
        this.annotations.shared(slug).subscribe({
          next: (res) => this.items.set(res.items),
          // The page reads as if nothing was shared: a failed extra is not worth an error on a paper's page.
          error: () => this.items.set([]),
        }),
      );
    });
  }

  protected pageLabel(page: number): string {
    return $localize`:@@papers.notes.page:Page ${page}:page:`;
  }

  protected when(iso: string): string {
    return formatPaperDate(iso.slice(0, 10), this.locale);
  }
}
