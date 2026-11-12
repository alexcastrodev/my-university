import { Marked } from 'marked';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Links to web pages and mail, or no scheme at all (relative). `marked` lets `javascript:`, `data:` and `vbscript:` through, and Angular's sanitizer only stops the first. */
const hasUnsafeScheme = (href: string) => {
  const url = href.replace(/[\u0000-\u0020]/g, '');
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^(https?|mailto):/i.test(url);
};

/** Handles the server resolved for the post being rendered; set only for the length of one synchronous parse. */
let mentionable: ReadonlySet<string> = new Set();

/** Same shape the server extracts (`extractMentions`): `@` not glued to a word, an e-mail address or a path. */
const MENTION_START = /(^|[^\p{L}\p{N}_@./-])@[a-z0-9]/iu;
const MENTION = /^@([a-z0-9]+(?:-[a-z0-9]+)*)/i;

/** Own instance: the site-wide `marked` carries deep-dive and viz extensions meant for trusted content, not student posts. */
const posts = new Marked({ gfm: true, breaks: true });
posts.use({
  extensions: [
    {
      // Inline only, so `@` in code stays code. Only handles the server vouched for become links, and a
      // handle is letters, digits and hyphens, so nothing typed after the `@` can reach the markup.
      name: 'mention',
      level: 'inline',
      start(src: string) {
        const match = MENTION_START.exec(src);
        return match ? match.index + match[1].length : undefined;
      },
      tokenizer(src: string) {
        const match = MENTION.exec(src);
        const handle = match?.[1].toLowerCase();
        if (!match || !handle || !mentionable.has(handle)) return undefined;
        return { type: 'mention', raw: match[0], handle };
      },
      renderer(token) {
        const handle = escapeHtml(String(token['handle']));
        return `<a class="mention" href="/u/${handle}">@${handle}</a>`;
      },
    },
  ],
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

/**
 * Markdown of a student post as an HTML string. Bind it with [innerHTML] (never bypass the sanitizer).
 * `mentions` are the handles the server resolved for this post (`CommentView.mentions`): those `@handle`s
 * link to the public profile, any other `@` stays text.
 */
export function renderPostMarkdown(source: string, mentions: readonly string[] = []): string {
  mentionable = new Set(mentions);
  try {
    return posts.parse(source, { async: false });
  } catch {
    // marked recurses once per nesting level (`>` repeated): a post that overflows the stack must not
    // throw while the page of every reader renders. It shows as plain text instead.
    return `<p>${escapeHtml(source)}</p>`;
  } finally {
    mentionable = new Set();
  }
}
