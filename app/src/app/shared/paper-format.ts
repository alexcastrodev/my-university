import { AnalysisSectionKey, AnalysisSectionState, LibraryStatus, PaperType, PublicationStage } from '../models/paper.model';

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

/** Where a paper stands, in a few words. Never worded as a seal of approval. */
export function stageLabel(stage: PublicationStage): string {
  switch (stage) {
    case 'preprint':
      return $localize`:@@papers.stage.preprint:Preprint: not reviewed yet`;
    case 'published':
      return $localize`:@@papers.stage.published:Published`;
    case 'thesis':
      return $localize`:@@papers.stage.thesis:Thesis`;
    case 'report':
      return $localize`:@@papers.stage.report:Report`;
    default:
      return $localize`:@@papers.stage.unknown:Status unknown`;
  }
}

/** What the stage means for someone who has never read a paper: one sentence, no jargon. */
export function stageNote(stage: PublicationStage): string {
  switch (stage) {
    case 'preprint':
      return $localize`:@@papers.stage.preprint.note:The authors shared this before other experts checked it. Its results may change or turn out to be wrong, so treat it as work in progress, not as settled.`;
    case 'published':
      return $localize`:@@papers.stage.published.note:It appeared in a journal, conference or book, which normally review work before accepting it. Even so, one study is never the final word.`;
    case 'thesis':
      return $localize`:@@papers.stage.thesis.note:Written to earn a university degree and examined by a committee. It is not the same as a paper reviewed by a journal.`;
    case 'report':
      return $localize`:@@papers.stage.report.note:Published by an institution or a company. Independent experts did not necessarily review it.`;
    default:
      return $localize`:@@papers.stage.unknown.note:We do not know whether other experts reviewed this. Check where it was published before relying on it.`;
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

/** What a refused or failed PDF upload means, in the reader's language. `code` is the API's stable code. */
export function attachmentErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case 'not_pdf':
      return $localize`:@@papers.attachment.error.notPdf:This file is not a PDF.`;
    case 'malformed':
      return $localize`:@@papers.attachment.error.malformed:This PDF is damaged or incomplete.`;
    case 'encrypted':
      return $localize`:@@papers.attachment.error.encrypted:Encrypted PDFs are not accepted. Remove the restrictions and try again.`;
    case 'active_content':
      return $localize`:@@papers.attachment.error.activeContent:This PDF contains scripts or actions that open files or forms, which are not accepted.`;
    case 'unscannable':
      return $localize`:@@papers.attachment.error.unscannable:This PDF could not be checked, so it was not accepted.`;
    case 'too_large':
      return $localize`:@@papers.attachment.error.tooLarge:The file is larger than 25 MB.`;
    case 'quota_exceeded':
      return $localize`:@@papers.attachment.error.quota:Your PDF storage is full. Remove one to upload another.`;
    case 'upload_in_progress':
      return $localize`:@@papers.attachment.error.inProgress:Another upload is still running. Wait for it to finish.`;
    case 'expired':
    case 'upload_expired':
      return $localize`:@@papers.attachment.error.expired:The upload did not finish. Try again.`;
    case 'storage_unavailable':
      return $localize`:@@papers.attachment.error.storage:The file could not be stored right now. Try again in a moment.`;
    default:
      return $localize`:@@papers.attachment.error.generic:The file could not be uploaded. Try again.`;
  }
}

/** A file size as a person reads it: "340 KB", "4.2 MB". */
export function formatFileSize(bytes: number, locale: string): string {
  const mega = bytes >= 1024 * 1024;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: mega ? 'megabyte' : 'kilobyte',
    maximumFractionDigits: mega ? 1 : 0,
  }).format(mega ? bytes / (1024 * 1024) : Math.max(bytes / 1024, 1));
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
