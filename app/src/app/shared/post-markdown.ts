import { Marked } from 'marked';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Links to web pages and mail, or no scheme at all (relative). `marked` lets `javascript:`, `data:` and `vbscript:` through, and Angular's sanitizer only stops the first. */
const hasUnsafeScheme = (href: string) => {
  const url = href.replace(/[\u0000-\u0020]/g, '');
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^(https?|mailto):/i.test(url);
};

/** Own instance: the site-wide `marked` carries deep-dive and viz extensions meant for trusted content, not student posts. */
const posts = new Marked({ gfm: true, breaks: true });
posts.use({
  renderer: {
    // Raw HTML typed by a student shows up as text; Angular's [innerHTML] sanitizer is the second line of defence.
    html: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      if (hasUnsafeScheme(href)) return this.parser.parseInline(tokens);
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tokens)}</a>`;
    },
    image: ({ text }) => escapeHtml(text),
  },
});

/** Markdown of a student post as an HTML string. Bind it with [innerHTML] (never bypass the sanitizer). */
export function renderPostMarkdown(source: string): string {
  try {
    return posts.parse(source, { async: false });
  } catch {
    // marked recurses once per nesting level (`>` repeated): a post that overflows the stack must not
    // throw while the page of every reader renders. It shows as plain text instead.
    return `<p>${escapeHtml(source)}</p>`;
  }
}
