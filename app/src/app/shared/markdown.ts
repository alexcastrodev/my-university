import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

const wikiLinkExtension = {
  name: 'wikiLink',
  level: 'inline' as const,
  start(src: string) { return src.indexOf('[['); },
  tokenizer(src: string) {
    const match = /^\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/.exec(src);
    if (!match) return undefined;
    const slug = match[1].trim();
    const label = (match[2] ?? slug).trim();
    return { type: 'wikiLink', raw: match[0], slug, label } as any;
  },
  renderer(token: any) {
    const m = /^(\d+)-(\d+)(?:-|$)/.exec(token.slug);
    const lessonId = m ? `j25-${m[1]}-${m[2]}` : token.slug;
    return `<a class="wiki-link" data-lesson-id="${lessonId}" href="#lesson/${lessonId}">${token.label}</a>`;
  },
};
marked.use({ extensions: [wikiLinkExtension] });

export function parseMarkdown(sanitizer: DomSanitizer, raw: string): SafeHtml {
  const rawHtml = marked.parse(raw) as string;
  return sanitizer.bypassSecurityTrustHtml(rawHtml);
}
