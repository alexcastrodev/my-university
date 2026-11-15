import { answerToPlain, renderKurzText } from './kurz-text';

describe('renderKurzText', () => {
  it('escapes everything the model wrote, so no tag survives', () => {
    const html = renderKurzText('<img src=x onerror=alert(1)> and <script>x</script> & "quotes"');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp;');
  });

  it('shows no link and no image, even written as markdown', () => {
    const html = renderKurzText(
      'See [the docs](https://evil.example) and ![x](https://evil.example/a.png)',
    );
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href');
  });

  it('turns bold, inline code and lists into tags', () => {
    expect(renderKurzText('a **b** and `c`')).toBe(
      '<p>a <strong>b</strong> and <code>c</code></p>',
    );
    expect(renderKurzText('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('keeps a line break between paragraphs and drops empty lines', () => {
    expect(renderKurzText('one\n\ntwo')).toBe('<p>one</p><p>two</p>');
  });

  it('does not let escaped text turn into a tag by the replacements', () => {
    expect(renderKurzText('**<b>x</b>**')).toBe('<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>');
  });
});

describe('answerToPlain', () => {
  it('joins the blocks with a blank line and no citation numbers', () => {
    expect(answerToPlain({ blocks: [{ text: ' first ' }, { text: '' }, { text: 'second' }] })).toBe(
      'first\n\nsecond',
    );
  });
});
