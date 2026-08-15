import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { parseMarkdown } from './markdown';

export function getReferenceIcon(type: 'video' | 'doc'): string {
  return type === 'video' ? '🎬' : '📄';
}

/** The section a reader (and an LLM skimming the page) should see first — an explicit "Short/Quick Answer" if present, else the first section. */
export function pickLeadSection<T extends { title: string; content: string }>(
  sections: T[],
): T | undefined {
  return sections.find((s) => /short answer|quick answer/i.test(s.title)) ?? sections[0];
}

export function mapConceptSections(
  sections: { title: string; content: string }[],
  excludeTitle: string,
  sanitizer: DomSanitizer,
): { title: string; html: SafeHtml }[] {
  return sections
    .filter((section) => section.title !== excludeTitle)
    .map((section) => ({ title: section.title, html: parseMarkdown(sanitizer, section.content).html }));
}
