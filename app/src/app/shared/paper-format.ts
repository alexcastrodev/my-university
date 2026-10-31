import { AnalysisSectionKey, AnalysisSectionState, LibraryStatus, PaperType } from '../models/paper.model';

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

/** The name of a reading status, in the reader's language. */
export function libraryStatusLabel(status: LibraryStatus): string {
  switch (status) {
    case 'reading':
      return $localize`:@@papers.library.status.reading:Reading`;
    case 'read':
      return $localize`:@@papers.library.status.read:Read`;
    default:
      return $localize`:@@papers.library.status.toRead:To read`;
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

/** The title of a section of the Research Analysis, in the reader's language. */
export function analysisSectionTitle(key: AnalysisSectionKey): string {
  switch (key) {
    case 'overview':
      return $localize`:@@papers.analysis.section.overview:Overview`;
    case 'contribution':
      return $localize`:@@papers.analysis.section.contribution:Contribution`;
    case 'methodology':
      return $localize`:@@papers.analysis.section.methodology:Methodology`;
    case 'findings':
      return $localize`:@@papers.analysis.section.findings:Findings`;
    case 'criticalAnalysis':
      return $localize`:@@papers.analysis.section.criticalAnalysis:Critical Analysis`;
    case 'furtherResearch':
      return $localize`:@@papers.analysis.section.furtherResearch:Further Research`;
  }
}

/** What a section says when it has no text, so an empty section is explained instead of left blank. */
export function analysisStateLabel(state: Exclude<AnalysisSectionState, 'present'>): string {
  switch (state) {
    case 'not_applicable':
      return $localize`:@@papers.analysis.state.notApplicable:Not applicable to this paper.`;
    case 'not_reported':
      return $localize`:@@papers.analysis.state.notReported:The paper does not report this.`;
    case 'unable_to_determine':
      return $localize`:@@papers.analysis.state.unableToDetermine:Could not be determined from the paper.`;
  }
}

/** Plain text with blank lines between paragraphs, as the abstract and the analysis sections are stored. */
export function paragraphsOf(text: string | null): string[] {
  return (text ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}
