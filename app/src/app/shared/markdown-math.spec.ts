import { DomSanitizer } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { parseMarkdown } from './markdown';

function render(raw: string): string {
  const sanitizer = TestBed.inject(DomSanitizer);
  const { html } = parseMarkdown(sanitizer, raw);
  return (html as unknown as { changingThisBreaksApplicationSecurity: string }).changingThisBreaksApplicationSecurity;
}

describe('parseMarkdown math', () => {
  it('renders inline $...$ with KaTeX', () => {
    const html = render('The loss is $L = -\\log \\sigma(x)$ per pair.');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('$L');
  });

  it('renders a $$...$$ paragraph as display math', () => {
    const html = render('Before.\n\n$$\\frac{a}{b}$$\n\nAfter.');
    expect(html).toContain('class="math-display"');
    expect(html).toContain('katex-display');
    expect(html).toContain('<p>After.</p>');
  });

  it('leaves prices and escaped dollars as plain text', () => {
    const html = render('It costs $5 or $10, and the stack bottom is \\$.');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5 or $10');
    expect(html).toContain('bottom is $.');
  });

  it('does not touch dollars inside code', () => {
    const html = render('Run `echo $HOME$` and\n\n```bash\nexport A=$B$C\n```');
    expect(html).not.toContain('katex');
    expect(html).toContain('echo $HOME$');
  });

  it('shows invalid TeX as an error instead of throwing', () => {
    expect(() => render('Broken: $\\frac{a$')).not.toThrow();
  });
});
