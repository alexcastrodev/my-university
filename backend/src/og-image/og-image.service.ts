import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

const WIDTH = 1200;
const HEIGHT = 630;
const MARGIN_X = 88;
const ACCENT_COLOR = '#c74634';
const TITLE_COLOR = '#111827';
const MUTED_COLOR = '#6b7280';
const FONT_FAMILY = 'DejaVu Sans, Arial, Helvetica, sans-serif';
const MAX_TITLE_LENGTH = 200;
const DEFAULT_TITLE = 'My University';

interface TitleLayout {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

@Injectable()
export class OgImageService {
  async render(rawTitle: string | undefined): Promise<Buffer> {
    const svg = this.buildSvg(this.sanitizeTitle(rawTitle));
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  private sanitizeTitle(rawTitle: string | undefined): string {
    const title = (rawTitle ?? '').trim();
    if (!title) return DEFAULT_TITLE;
    return title.length > MAX_TITLE_LENGTH
      ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…`
      : title;
  }

  private buildSvg(title: string): string {
    const layout = this.layoutTitle(title);
    const titleStartY =
      HEIGHT / 2 - ((layout.lines.length - 1) * layout.lineHeight) / 2;

    const titleTspans = layout.lines
      .map(
        (line, i) =>
          `<tspan x="${MARGIN_X}" y="${titleStartY + i * layout.lineHeight}">${this.escapeXml(line)}</tspan>`,
      )
      .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" />
  <rect x="0" y="0" width="14" height="${HEIGHT}" fill="${ACCENT_COLOR}" />
  <text x="${MARGIN_X}" y="120" font-family="${FONT_FAMILY}" font-size="26" font-weight="700" letter-spacing="2" fill="${ACCENT_COLOR}">MY UNIVERSITY</text>
  <text font-family="${FONT_FAMILY}" font-size="${layout.fontSize}" font-weight="700" fill="${TITLE_COLOR}">${titleTspans}</text>
  <text x="${MARGIN_X}" y="${HEIGHT - 70}" font-family="${FONT_FAMILY}" font-size="24" fill="${MUTED_COLOR}">university.kurz.fyi</text>
</svg>`;
  }

  /** Rough word-wrap using an average glyph-width heuristic (no real font metrics available server-side). */
  private layoutTitle(title: string): TitleLayout {
    const maxWidth = WIDTH - MARGIN_X * 2;
    const fontSize = title.length > 90 ? 48 : title.length > 55 ? 56 : 68;
    const avgCharWidth = fontSize * 0.56;
    const maxCharsPerLine = Math.max(10, Math.floor(maxWidth / avgCharWidth));

    const words = title.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxCharsPerLine && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);

    const maxLines = 4;
    if (lines.length > maxLines) {
      const truncated = lines.slice(0, maxLines);
      truncated[maxLines - 1] =
        `${truncated[maxLines - 1].replace(/\s+\S*$/, '')}…`;
      return { lines: truncated, fontSize, lineHeight: fontSize * 1.2 };
    }

    return { lines, fontSize, lineHeight: fontSize * 1.2 };
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
