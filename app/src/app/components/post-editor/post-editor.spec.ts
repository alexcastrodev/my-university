import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PostEditor } from './post-editor';

describe('PostEditor', () => {
  let fixture: ComponentFixture<PostEditor>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PostEditor],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(PostEditor);
    el = fixture.nativeElement;
  });

  /** `hidden` alone is not enough: a component's own `display` rule beats it, so look at what the browser paints. */
  const shown = (selector: string) => getComputedStyle(el.querySelector(selector)!).display !== 'none';

  async function preview(markdown: string): Promise<void> {
    fixture.componentRef.setInput('value', markdown);
    await fixture.whenStable();
    el.querySelectorAll<HTMLButtonElement>('.tab')[1].click();
    await fixture.whenStable();
  }

  it('starts on Write, with the textarea and toolbar visible', async () => {
    await fixture.whenStable();
    expect(shown('textarea')).toBe(true);
    expect(shown('.toolbar')).toBe(true);
    expect(el.querySelector('.preview')).toBeNull();
  });

  it('previews a fenced block as code, the way the published comment shows it', async () => {
    await preview('Try this:\n\n```java\nint x = 1;\n```');
    expect(el.querySelector('.preview pre code')?.textContent).toContain('int x = 1;');
    expect(shown('textarea')).toBe(false);
    expect(shown('.toolbar')).toBe(false);
  });

  it('shows raw HTML as text instead of rendering it', async () => {
    await preview('<img src=x onerror=alert(1)>');
    expect(el.querySelector('.preview img')).toBeNull();
    expect(el.querySelector('.preview')!.textContent).toContain('<img');
  });

  it('goes back to Write once the draft is cleared, as after sending', async () => {
    await preview('some text');
    expect(shown('textarea')).toBe(false);
    fixture.componentRef.setInput('value', '');
    await fixture.whenStable();
    expect(shown('textarea')).toBe(true);
    expect(el.querySelector('.preview')).toBeNull();
  });

  it('says there is nothing to preview for an empty draft, and keeps the draft when going back to Write', async () => {
    await preview('   ');
    expect(el.querySelector('.preview.empty')).not.toBeNull();
    el.querySelectorAll<HTMLButtonElement>('.tab')[0].click();
    await fixture.whenStable();
    expect(el.querySelector('.preview')).toBeNull();
    expect(el.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('   ');
  });

  it('does not squash the box to its padding when it is measured while hidden', async () => {
    const area = el.querySelector<HTMLTextAreaElement>('textarea')!;
    el.style.display = 'none';
    fixture.componentRef.setInput('value', 'text');
    await fixture.whenStable();
    expect(area.style.height).not.toBe('0px');
    el.style.display = '';
    expect(area.offsetHeight).toBeGreaterThan(60);
  });

  describe('in a narrow editor', () => {
    const narrow = async () => {
      el.style.width = '320px';
      fixture.componentRef.setInput('value', 'text');
      await fixture.whenStable();
    };
    const items = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.menu .item'));
    const dots = () => el.querySelector<HTMLButtonElement>('.more')!;

    it('keeps Bold, Italic and Code block and folds the rest into a menu', async () => {
      await narrow();
      expect(shown('.more-wrap')).toBe(true);
      expect(shown('.tool[aria-label="Bold"]')).toBe(true);
      expect(shown('.tool[aria-label="Code block"]')).toBe(true);
      expect(shown('.tool[aria-label="Link"]')).toBe(false);
    });

    it('opens the menu with the folded tools and applies one to the selection', async () => {
      await narrow();
      expect(el.querySelector('.menu')).toBeNull();
      dots().click();
      await fixture.whenStable();
      expect(items().map((i) => i.textContent!.trim())).toEqual([
        'Strikethrough', 'Quote', 'Inline code', 'Link', 'List', 'Numbered list',
      ]);
      const area = el.querySelector<HTMLTextAreaElement>('textarea')!;
      area.setSelectionRange(0, 4);
      items()[0].click();
      await fixture.whenStable();
      expect(area.value).toBe('~~text~~');
      expect(el.querySelector('.menu')).toBeNull();
    });

    it('closes on a click outside, and on Escape without letting it reach the page', async () => {
      await narrow();
      dots().click();
      await fixture.whenStable();
      document.body.click();
      await fixture.whenStable();
      expect(el.querySelector('.menu')).toBeNull();

      const reachedPage = jasmine.createSpy('escape reached the page');
      document.addEventListener('keydown', reachedPage);
      dots().click();
      await fixture.whenStable();
      dots().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      document.removeEventListener('keydown', reachedPage);
      expect(el.querySelector('.menu')).toBeNull();
      expect(reachedPage).not.toHaveBeenCalled();
    });

    it('shows the whole toolbar again when there is room', async () => {
      await narrow();
      el.style.width = '700px';
      await fixture.whenStable();
      expect(shown('.more-wrap')).toBe(false);
      expect(shown('.tool[aria-label="Link"]')).toBe(true);
    });
  });

  describe('mentions', () => {
    const ANA = { handle: 'ana-dev', name: 'Ana Souza', avatarUrl: '' };
    const BIA = { handle: 'bia', name: 'Bia Lima', avatarUrl: '' };
    let http: HttpTestingController;
    let area: HTMLTextAreaElement;

    beforeEach(async () => {
      jasmine.clock().install();
      http = TestBed.inject(HttpTestingController);
      await fixture.whenStable();
      area = el.querySelector<HTMLTextAreaElement>('textarea')!;
    });

    afterEach(() => {
      jasmine.clock().uninstall();
      http.verify();
    });

    /** Types `text` at the end of the box, as an input event would leave it. */
    const type = (text: string) => {
      area.focus();
      area.value += text;
      area.setSelectionRange(area.value.length, area.value.length);
      area.dispatchEvent(new Event('input'));
    };
    const key = (k: string) => area.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const options = () => Array.from(el.querySelectorAll<HTMLElement>('[role="option"]'));
    const answer = async (q: string, people: typeof ANA[]) => {
      jasmine.clock().tick(250);
      http.expectOne((r) => r.url === '/api/discussions/mentions' && r.params.get('q') === q).flush(people);
      await fixture.whenStable();
    };

    it('asks once per pause in typing, not once per key', async () => {
      type('hi @a');
      jasmine.clock().tick(100);
      type('n');
      await answer('an', [ANA, BIA]);
      expect(options().map((o) => o.textContent)).toEqual([
        jasmine.stringContaining('@ana-dev'),
        jasmine.stringContaining('@bia'),
      ]);
    });

    // A textarea may not take role="combobox" (axe aria-allowed-role), so it stays a textbox with list autocomplete.
    it('wires the textarea to the listbox as a textbox with list autocomplete', async () => {
      expect(area.getAttribute('role')).toBeNull();
      expect(area.getAttribute('aria-autocomplete')).toBe('list');
      expect(area.getAttribute('aria-activedescendant')).toBeNull();
      type('@an');
      await answer('an', [ANA, BIA]);
      const list = el.querySelector('[role="listbox"]')!;
      expect(area.getAttribute('aria-controls')).toBe(list.id);
      expect(area.getAttribute('aria-activedescendant')).toBe(options()[0].id);
      expect(options()[0].getAttribute('aria-selected')).toBe('true');
    });

    it('moves with the arrows and picks with Enter, leaving the handle and a space', async () => {
      type('cc @b');
      await answer('b', [ANA, BIA]);
      key('ArrowDown');
      await fixture.whenStable();
      expect(area.getAttribute('aria-activedescendant')).toBe(options()[1].id);
      key('Enter');
      await fixture.whenStable();
      expect(area.value).toBe('cc @bia ');
      expect(options()).toEqual([]);
      expect(fixture.componentInstance.value()).toBe('cc @bia ');
    });

    it('does not send the post when Enter picks a suggestion', async () => {
      const sent = jasmine.createSpy('submitted');
      fixture.componentInstance.submitted.subscribe(sent);
      type('@an');
      await answer('an', [ANA]);
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(sent).not.toHaveBeenCalled();
    });

    it('closes on Escape without letting it reach the page', async () => {
      type('@an');
      await answer('an', [ANA]);
      const reachedPage = jasmine.createSpy('escape reached the page');
      document.addEventListener('keydown', reachedPage);
      key('Escape');
      document.removeEventListener('keydown', reachedPage);
      await fixture.whenStable();
      expect(options()).toEqual([]);
      expect(reachedPage).not.toHaveBeenCalled();
    });

    it('ignores an @ inside a word, like an e-mail address', async () => {
      type('mail ana@bob');
      jasmine.clock().tick(250);
      http.expectNone('/api/discussions/mentions');
      expect(options().length).toBe(0);
    });

    it('drops a late answer for a query the reader already typed past', async () => {
      type('@a');
      jasmine.clock().tick(250);
      const stale = http.expectOne((r) => r.params.get('q') === 'a');
      type('n');
      await answer('an', [BIA]);
      stale.flush([ANA]);
      await fixture.whenStable();
      expect(options().map((o) => o.textContent)).toEqual([jasmine.stringContaining('@bia')]);
    });

    it('warns past ten people mentioned', async () => {
      fixture.componentRef.setInput('value', Array.from({ length: 11 }, (_, i) => `@user${i}`).join(' '));
      await fixture.whenStable();
      expect(el.querySelector('.mention-limit')?.textContent).toContain('at most 10');
    });
  });
});
