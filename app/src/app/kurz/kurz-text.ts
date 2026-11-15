/**
 * The text of a Kurz answer as HTML. The server already strips links and images, and this renders no link
 * or image either, so the answer cannot send the student anywhere: it escapes everything, then turns
 * `**bold**`, `` `code` `` and `- ` lists into tags. Pages it points to come as citations, from our own table.
 */
export function renderKurzText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let list = false;
  for (const raw of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (bullet) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (list) out.push('</ul>');
    list = false;
    if (raw.trim()) out.push(`<p>${inline(raw)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** An answer as plain text, for the "copy" button: the blocks, without the citation numbers. */
export function answerToPlain(answer: { blocks: { text: string }[] }): string {
  return answer.blocks
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n\n');
}
