import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PostEditor } from './post-editor';

describe('PostEditor', () => {
  let fixture: ComponentFixture<PostEditor>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PostEditor],
      providers: [provideZonelessChangeDetection()],
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
});
