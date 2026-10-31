import { renderNoteMarkdown } from './safe-markdown';

describe('renderNoteMarkdown', () => {
  it('keeps the markup the reader writes', () => {
    const html = renderNoteMarkdown('**bold** and `code`\n\n- one\n- two');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
  });

  it('shows HTML as text instead of making it', () => {
    const html = renderNoteMarkdown('<script>alert(1)</script><img src=x onerror=alert(2)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
  });

  it('shows block HTML as text too', () => {
    const html = renderNoteMarkdown('<div onclick="alert(1)">hi</div>\n\n<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain('<div');
    expect(html).not.toContain('<iframe');
  });

  it('does not load images, it shows their description', () => {
    const html = renderNoteMarkdown('![tracking pixel](https://evil.example/p.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('tracking pixel');
  });

  it('makes links only for http, https and mailto, and opens them safely', () => {
    expect(renderNoteMarkdown('[paper](https://example.org/a?b=1&c=2)')).toContain('<a href="https://example.org/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">paper</a>');
    expect(renderNoteMarkdown('[mail](mailto:ada@example.org)')).toContain('href="mailto:ada@example.org"');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x']) {
      const html = renderNoteMarkdown(`[click](${bad})`);
      expect(html).not.toContain('<a');
      expect(html).toContain('click');
    }
  });

  it('cannot break out of a link attribute', () => {
    const html = renderNoteMarkdown('[x](https://example.org/"onmouseover="alert(1))');
    expect(html).not.toMatch(/<a[^>]*\sonmouseover=/);
  });
});
