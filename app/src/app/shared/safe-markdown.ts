import { Marked, Tokens } from 'marked';

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Only these links are made: a note is typed by a reader, so `javascript:` and `data:` never become one. */
const SAFE_LINK = /^(https?:|mailto:)/i;

/**
 * Markdown for what a reader types (notes, comments): the markup they write works, the HTML they write is
 * shown as text, images are not loaded (no request leaves the page because of a note) and a link is made only
 * for http, https and mailto. Unlike `parseMarkdown`, which renders our own authored content, nothing here is
 * trusted, so the result is bound to `[innerHTML]` as a plain string and Angular sanitizes it once more.
 */
const notes = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }: { text: string }) => escapeHtml(text),
    image: ({ text }: Tokens.Image) => escapeHtml(text),
    link(this: { parser: { parseInline(tokens: Tokens.Link['tokens']): string } }, { href, tokens }: Tokens.Link) {
      const label = this.parser.parseInline(tokens);
      return SAFE_LINK.test(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    },
  },
});

export function renderNoteMarkdown(raw: string): string {
  return notes.parse(raw, { async: false });
}
