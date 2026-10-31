import { PaperType } from '../models/paper.model';

/** The name of a publication type, in the reader's language. */
export function paperTypeLabel(type: PaperType): string {
  switch (type) {
    case 'journal-article':
      return $localize`:@@papers.type.journalArticle:Journal article`;
    case 'conference-paper':
      return $localize`:@@papers.type.conferencePaper:Conference paper`;
    case 'preprint':
      return $localize`:@@papers.type.preprint:Preprint`;
    case 'book-chapter':
      return $localize`:@@papers.type.bookChapter:Book chapter`;
    case 'book':
      return $localize`:@@papers.type.book:Book`;
    case 'thesis':
      return $localize`:@@papers.type.thesis:Thesis`;
    case 'report':
      return $localize`:@@papers.type.report:Report`;
    default:
      return $localize`:@@papers.type.other:Other`;
  }
}

/**
 * A publication date as far as it is known: `2024` stays a year, `2024-05` becomes "May 2024" and
 * `2024-05-17` a full date. The date is read as UTC so a time zone never moves it to another day.
 */
export function formatPaperDate(date: string, locale: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!month) return String(year);
  const at = new Date(Date.UTC(year, month - 1, day ?? 1));
  const options: Intl.DateTimeFormatOptions = day
    ? { dateStyle: 'long', timeZone: 'UTC' }
    : { year: 'numeric', month: 'long', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(locale, options).format(at);
}

/** Only web links become hrefs: a stored URL is data, not something to trust with `javascript:`. */
export function safeWebUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}
