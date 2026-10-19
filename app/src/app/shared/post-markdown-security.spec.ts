import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { renderPostMarkdown } from './post-markdown';

@Component({ template: '<div id="out" [innerHTML]="html()"></div>' })
class Host {
  html = signal('');
}

/** Payloads that gave XSS in forum software (markdown/BBCode renderers) over the years. */
const PAYLOADS: Record<string, string> = {
  'js link': '[x](javascript:alert(1))',
  'js link mixed case': '[x](JaVaScRiPt:alert(1))',
  'js link leading space': '[x](  javascript:alert(1))',
  'js link tab entity': '[x](java&#x09;script:alert(1))',
  'js link numeric entity': '[x](&#106;avascript:alert(1))',
  'js link colon entity': '[x](javascript&colon;alert(1))',
  'js link angle': '[x](<javascript:alert(1)>)',
  'data html link': '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  'vbscript link': '[x](vbscript:msgbox(1))',
  'js autolink': '<javascript:alert(1)>',
  'autolink attribute break': '<https://x.com" onmouseover="alert(1)>',
  'reference link': '[x][a]\n\n[a]: javascript:alert(1)',
  'link quote break': '[x](https://a.b/"onmouseover="alert(1))',
  'link angle quote break': '[x](<https://a.b/" onmouseover="alert(1)>)',
  'link title break': '[x](https://a.b "\\" onmouseover=\\"alert(1)")',
  'html in link text': '[<img src=x onerror=alert(1)>](https://a.b)',
  'script tag': '<script>alert(1)</script>',
  'img onerror': '<img src=x onerror=alert(1)>',
  'svg onload': '<svg/onload=alert(1)>',
  'iframe js': '<iframe src="javascript:alert(1)"></iframe>',
  'raw anchor js': '<a href="javascript:alert(1)">x</a>',
  'details ontoggle': '<details open ontoggle=alert(1)>x</details>',
  'style tag': '<style>@import "https://evil.test/x.css";</style>',
  'meta refresh': '<meta http-equiv="refresh" content="0;url=https://evil.test">',
  'base tag': '<base href="https://evil.test/">',
  'form post': '<form action="https://evil.test"><input name=p><button>go</button></form>',
  'mxss math': '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">',
  'mxss noscript': '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  'image js url': '![x](javascript:alert(1))',
  'image alt break': '![x" onerror="alert(1)](a.png)',
  'image alt html': '![<img src=x onerror=alert(1)>](a.png)',
  'fence info break': '```"><img src=x onerror=alert(1)>\ncode\n```',
  'fence info attr': '```js" onclick="alert(1)\ncode\n```',
  'codespan html': '`<img src=x onerror=alert(1)>`',
  'table cell html': '| a |\n|---|\n| <img src=x onerror=alert(1)> |',
  'heading html': '# <img src=x onerror=alert(1)>',
  'blockquote html': '> <svg onload=alert(1)>',
  'entity script': '&lt;script&gt;alert(1)&lt;/script&gt;',
  'null byte': '[x](java\0script:alert(1))',
};

/** 2000 characters is the server's cap on a body; none of these may make rendering slow. */
const PATHOLOGICAL: Record<string, string> = {
  brackets: '['.repeat(2000),
  parens: '[x]' + '('.repeat(1997),
  stars: '*'.repeat(2000),
  underscores: '_'.repeat(2000),
  backticks: '`'.repeat(2000),
  'nested emphasis': '*_'.repeat(1000),
  'nested quotes': '>'.repeat(2000),
  'nested lists': '- '.repeat(1000),
  'link spam': '[a](b)'.repeat(333),
  lt: '<'.repeat(2000),
  amp: '&'.repeat(2000),
};

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];
const FORBIDDEN = 'script,iframe,object,embed,svg,math,img,style,form,base,meta,link,input,textarea,button,video,audio,source,frame,frameset';

describe('post markdown security (XSS corpus through the real Angular sanitizer)', () => {
  const w = window as unknown as { __xss?: boolean; alert: (m?: unknown) => void };
  const realAlert = w.alert;

  beforeEach(() => {
    delete w.__xss;
    w.alert = () => {
      w.__xss = true;
    };
  });

  afterEach(() => {
    w.alert = realAlert;
  });

  function mount(markdown: string): HTMLElement {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.html.set(renderPostMarkdown(markdown));
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    return fixture.nativeElement.querySelector('#out') as HTMLElement;
  }

  function violations(root: HTMLElement): string[] {
    const found: string[] = [];
    root.querySelectorAll(FORBIDDEN).forEach((el) => found.push(`<${el.tagName.toLowerCase()}> element`));
    root.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('on')) found.push(`${attr.name} attribute on <${el.tagName.toLowerCase()}>`);
        if (attr.name === 'style' || attr.name === 'srcdoc') found.push(`${attr.name} attribute`);
      }
    });
    root.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href')!;
      // `unsafe:` is what Angular's sanitizer rewrites a dangerous URL to: it navigates nowhere.
      if (href.startsWith('unsafe:')) return;
      let protocol = '';
      try {
        protocol = new URL(href, 'https://site.test/').protocol;
      } catch {
        found.push(`unparsable href ${href}`);
        return;
      }
      if (!SAFE_PROTOCOLS.includes(protocol)) found.push(`href with protocol ${protocol}`);
      if (a.getAttribute('target') === '_blank' && !/noopener/.test(a.getAttribute('rel') ?? '')) {
        found.push('target=_blank without rel=noopener');
      }
    });
    return found;
  }

  for (const [name, payload] of Object.entries(PAYLOADS)) {
    it(`neutralizes: ${name}`, () => {
      const root = mount(payload);
      expect(violations(root)).withContext(root.innerHTML).toEqual([]);
      // Nothing may have run: a payload that executed would have flipped this flag.
      expect(w.__xss).toBeUndefined();
    });
  }

  it('never lets a javascript:, data: or vbscript: href reach the sanitizer', () => {
    for (const [name, payload] of Object.entries(PAYLOADS)) {
      expect(renderPostMarkdown(payload)).withContext(name).not.toMatch(/href="\s*(javascript|vbscript|data):/i);
    }
  });

  it('keeps the text of a link it refused, and still links web, mail and relative URLs', () => {
    expect(renderPostMarkdown('[docs](javascript:alert(1))')).toContain('docs');
    expect(renderPostMarkdown('[docs](javascript:alert(1))')).not.toContain('<a');
    for (const url of ['https://a.b/c?d=1&e=2', 'http://a.b', 'mailto:a@b.c', '/java/exams', '#top']) {
      expect(renderPostMarkdown(`[x](${url})`)).withContext(url).toContain('<a href=');
    }
  });

  it('shows a post nested too deep for the parser as plain text instead of throwing', () => {
    // 5000 levels overflow the parser's recursion in every engine, so this always takes the fallback.
    expect(renderPostMarkdown('>'.repeat(5000)).startsWith('<p>&gt;&gt;&gt;')).toBe(true);
  });

  for (const [name, payload] of Object.entries(PATHOLOGICAL)) {
    it(`renders a 2000 char "${name}" input quickly`, () => {
      const start = performance.now();
      renderPostMarkdown(payload);
      expect(performance.now() - start).toBeLessThan(250);
    });
  }
});
