import { describe, it, expect } from 'vitest';
import { firstSourceSnippet } from '../src/feed/feed.service';

describe('firstSourceSnippet', () => {
  const code = '```java\nint a = 1;\nint b = 2;\n```';

  it('skips the reference sections in either language', () => {
    for (const title of ['References', 'Referências', 'Documentation Links']) {
      expect(firstSourceSnippet([{ title, content: code }])).toBeNull();
    }
  });

  it('takes the first real code block from a content section', () => {
    expect(
      firstSourceSnippet([{ title: 'Aprofundamento', content: code }]),
    ).toEqual({
      lang: 'java',
      code: 'int a = 1;\nint b = 2;',
    });
  });
});
