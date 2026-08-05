import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TextSelectionService } from './text-selection';

function selectTextIn(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

function clearSelection(): void {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event('selectionchange'));
}

function waitForDebounce(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

describe('TextSelectionService', () => {
  let container: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });

    container = document.createElement('div');
    container.className = 'concept-section';
    container.innerHTML =
      '<p>Some selectable paragraph text used for testing purposes.</p>' +
      '<p>A second paragraph so a single-paragraph selection is a clear partial, not the whole container.</p>';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    clearSelection();
  });

  it('exposes the selected text and rect when selecting inside a content area', async () => {
    const service = TestBed.inject(TextSelectionService);

    selectTextIn(container.querySelector('p')!);
    await waitForDebounce();

    const state = service.selection();
    expect(state?.text).toContain('selectable paragraph');
    expect(state?.isSelectAll).toBeFalse();
  });

  it('ignores selections outside a marked content container', async () => {
    const outside = document.createElement('p');
    outside.textContent = 'Not selectable, outside content area';
    document.body.appendChild(outside);

    const service = TestBed.inject(TextSelectionService);
    selectTextIn(outside);
    await waitForDebounce();

    expect(service.selection()).toBeNull();
    outside.remove();
  });

  it('clears the selection state when the selection is emptied', async () => {
    const service = TestBed.inject(TextSelectionService);

    selectTextIn(container.querySelector('p')!);
    await waitForDebounce();
    expect(service.selection()).not.toBeNull();

    clearSelection();
    await waitForDebounce();
    expect(service.selection()).toBeNull();
  });

  it('flags select-all intent from Cmd/Ctrl+A inside a content area', async () => {
    const service = TestBed.inject(TextSelectionService);

    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    selectTextIn(container.querySelector('p')!);
    await waitForDebounce();

    expect(service.selection()?.isSelectAll).toBeTrue();
  });

  it('treats a selection covering nearly all of the container text as select-all', async () => {
    container.innerHTML = '<p>Short</p>';
    const service = TestBed.inject(TextSelectionService);

    selectTextIn(container.querySelector('p')!);
    await waitForDebounce();

    expect(service.selection()?.isSelectAll).toBeTrue();
  });
});
