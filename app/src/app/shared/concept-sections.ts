import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { parseMarkdown } from './markdown';

export function getReferenceIcon(type: 'video' | 'doc'): string {
  return type === 'video' ? '🎬' : '📄';
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
