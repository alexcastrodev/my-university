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

let deepDiveDefinitions: Map<string, string> = new Map();
let deepDiveTriggers: { id: string; phrase: string }[] = [];

const deepDiveDefinitionExtension = {
  name: 'deepDiveDefinition',
  level: 'block' as const,
  start(src: string) {
    const match = /^\[\^([\w-]+)\]:/m.exec(src);
    return match ? match.index : undefined;
  },
  tokenizer(src: string) {
    const match = /^\[\^([\w-]+)\]:[ \t]*([\s\S]*?)(?=\n\[\^[\w-]+\]:|\n#{1,6} |$)/.exec(src);
    if (!match) return undefined;
    return { type: 'deepDiveDefinition', raw: match[0], id: match[1], body: match[2].trim() } as any;
  },
  renderer(token: any) {
    deepDiveDefinitions.set(token.id, marked.parse(token.body) as string);
    return '';
  },
};

const deepDiveTriggerExtension = {
  name: 'deepDiveTrigger',
  level: 'inline' as const,
  start(src: string) { return src.indexOf('{{'); },
  tokenizer(src: string) {
    const match = /^\{\{([^{}]+)\}\}\[\^([\w-]+)\]/.exec(src);
    if (!match) return undefined;
    return { type: 'deepDiveTrigger', raw: match[0], phrase: match[1], id: match[2] } as any;
  },
  renderer(token: any) {
    deepDiveTriggers.push({ id: token.id, phrase: token.phrase });
    return `<span class="deep-dive-trigger" data-deepdive-id="${token.id}">${token.phrase}</span>`;
  },
};
marked.use({ extensions: [deepDiveDefinitionExtension, deepDiveTriggerExtension] });

export function parseMarkdown(
  sanitizer: DomSanitizer,
  raw: string,
): { html: SafeHtml; deepDives: { id: string; phrase: string; html: SafeHtml }[] } {
  deepDiveDefinitions = new Map();
  deepDiveTriggers = [];
  const rawHtml = marked.parse(raw) as string;
  const deepDives = deepDiveTriggers
    .filter(({ id }) => deepDiveDefinitions.has(id))
    .map(({ id, phrase }) => ({
      id,
      phrase,
      html: sanitizer.bypassSecurityTrustHtml(deepDiveDefinitions.get(id)!),
    }));
  return { html: sanitizer.bypassSecurityTrustHtml(rawHtml), deepDives };
}
