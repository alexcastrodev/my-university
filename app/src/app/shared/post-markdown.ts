import { Marked } from 'marked';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Own instance: the site-wide `marked` carries deep-dive and viz extensions meant for trusted content, not student posts. */
const posts = new Marked({ gfm: true, breaks: true });
posts.use({
  renderer: {
    // Raw HTML typed by a student shows up as text; Angular's [innerHTML] sanitizer is the second line of defence.
    html: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tokens)}</a>`;
    },
    image: ({ text }) => escapeHtml(text),
  },
});

/** Markdown of a student post as an HTML string. Bind it with [innerHTML] (never bypass the sanitizer). */
export function renderPostMarkdown(source: string): string {
  return posts.parse(source, { async: false });
}
