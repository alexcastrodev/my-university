/**
 * Markdown syntax is noise for both matching and the snippet shown under a result, so the body is
 * flattened to prose (code stays, since searching for an identifier is a real use case; only the
 * fences and markup characters go).
 */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/^```.*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`|]+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
