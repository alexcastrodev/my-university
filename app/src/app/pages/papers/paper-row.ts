import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PaperSummary } from '../../models/paper.model';
import { formatPaperDate, paperTypeLabel, safeWebUrl } from '../../shared/paper-format';
import { PaperStage } from './paper-stage';

const AUTHORS_SHOWN = 4;
const AVATARS_SHOWN = 3;

/** Up to two letters for a name: its first and its last word ("Grace Hopper" is "GH"). */
export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => Array.from(word).find((c) => /[\p{L}\p{N}]/u.test(c)))
    .filter((c): c is string => !!c);
  if (!letters.length) return '?';
  return (letters.length === 1 ? letters[0] : letters[0] + letters[letters.length - 1]).toUpperCase();
}

/** A stable hue (0 to 359) for a name, so the same person always gets the same color. */
export function hueOf(name: string): number {
  let hue = 0;
  for (const char of name) hue = (hue * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return hue;
}

/**
 * One paper in a list, laid out like a row of a research index: reference and date on top, the title, the
 * authors with small avatars, the start of the abstract with its source links, and the labels below. The
 * catalog and the library share it; what only one of them has goes in as content after the labels.
 */
@Component({
  selector: 'app-paper-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PaperStage],
  templateUrl: './paper-row.html',
  styleUrl: './paper-row.css',
})
export class PaperRow {
  readonly paper = input.required<PaperSummary>();
  /** Its place in the whole result (not only on this page), starting at 1. */
  readonly position = input.required<number>();
  /** Where the title leads. */
  readonly link = input.required<unknown[]>();
  /** The catalog turns the research area into a link to its filter; without it the area is plain text. */
  readonly areaParams = input<Record<string, string | number> | null>(null);

  private locale = inject(LOCALE_ID);

  protected readonly paperTypeLabel = paperTypeLabel;

  protected names = computed(() => this.paper().authors.slice(0, AUTHORS_SHOWN).join('; '));
  protected moreAuthors = computed(() => Math.max(0, this.paper().authors.length - AUTHORS_SHOWN));
  protected avatars = computed(() =>
    this.paper()
      .authors.slice(0, AVATARS_SHOWN)
      .map((name) => ({ initials: initialsOf(name), hue: hueOf(name) })),
  );
  protected date = computed(() => {
    const date = this.paper().publicationDate;
    return date ? formatPaperDate(date, this.locale) : null;
  });
  protected doiUrl = computed(() => {
    const doi = this.paper().doi;
    return doi ? `https://doi.org/${doi}` : null;
  });
  protected pageUrl = computed(() => safeWebUrl(this.paper().url));
}
