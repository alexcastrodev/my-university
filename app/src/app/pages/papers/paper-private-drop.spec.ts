import { titleFromFilename } from './paper-private-drop';

describe('titleFromFilename', () => {
  it('drops the extension and turns underscores into spaces', () => {
    expect(titleFromFilename('attention_is_all_you_need.pdf')).toBe('attention is all you need');
  });

  it('keeps hyphens and capitals, and collapses whitespace', () => {
    expect(titleFromFilename('  Smith-2020   Final.PDF ')).toBe('Smith-2020 Final');
  });

  it('is bounded, so the server limit is never the first to say so', () => {
    expect(titleFromFilename(`${'a'.repeat(400)}.pdf`).length).toBe(300);
  });
});
