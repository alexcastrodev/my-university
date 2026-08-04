import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import java from 'highlight.js/lib/languages/java';
import plaintext from 'highlight.js/lib/languages/plaintext';

hljs.registerLanguage('java', java);
hljs.registerLanguage('plaintext', plaintext);

const codeBlockRenderer = {
  code({ text, lang }: { text: string; lang?: string }) {
    if (lang === 'mermaid') {
      const encoded = encodeURIComponent(text);
      return `<div class="mermaid-diagram" data-mermaid-source="${encoded}"></div>`;
    }
    const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
    const highlighted = hljs.highlight(text, { language }).value;
    return `<pre><div class="code-lang">${language}</div><code class="hljs language-${language}">${highlighted}</code></pre>`;
  },
};
marked.use({ renderer: codeBlockRenderer });

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
