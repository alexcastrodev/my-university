import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';

/** Grows with its content up to this many px, then scrolls. */
const MAX_HEIGHT_PX = 420;

/**
 * A small markdown editor for posts: a toolbar over a textarea that grows as you type.
 * The value stays plain markdown text, so posts keep working with every existing endpoint.
 */
@Component({
  selector: 'app-post-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './post-editor.html',
  styleUrl: './post-editor.css',
})
export class PostEditor {
  value = model<string>('');
  placeholder = input<string>('');
  maxLength = input<number>(2000);
  minRows = input<number>(4);
  submitted = output<void>();

  private area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');

  constructor() {
    // The parent clears the draft after sending; the box has to shrink back with it.
    effect(() => {
      this.value();
      queueMicrotask(() => this.grow());
    });
  }

  protected onInput(): void {
    this.value.set(this.area().nativeElement.value);
    this.grow();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      this.submitted.emit();
    } else if (mod && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      this.wrap('**', '**', 'bold');
    } else if (mod && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      this.wrap('_', '_', 'italic');
    }
  }

  protected wrap(before: string, after: string, placeholder: string): void {
    const el = this.area().nativeElement;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const selected = value.slice(start, end) || placeholder;
    this.replace(start, end, `${before}${selected}${after}`, start + before.length, start + before.length + selected.length);
  }

  protected codeBlock(): void {
    const el = this.area().nativeElement;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const selected = value.slice(start, end) || 'code';
    const lead = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    const text = `${lead}\`\`\`\n${selected}\n\`\`\`\n`;
    const from = start + lead.length + 4;
    this.replace(start, end, text, from, from + selected.length);
  }

  /** Prefixes every selected line: `- ` for a bullet list, `1. ` for a numbered one, `> ` for a quote. */
  protected list(kind: 'bullet' | 'number' | 'quote'): void {
    const el = this.area().nativeElement;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(lineStart, end) || '';
    const text = (block || (kind === 'quote' ? 'quote' : 'item'))
      .split('\n')
      .map((line, i) => `${kind === 'bullet' ? '-' : kind === 'quote' ? '>' : `${i + 1}.`} ${line}`)
      .join('\n');
    this.replace(lineStart, end, text, lineStart + text.length, lineStart + text.length);
  }

  protected link(): void {
    const el = this.area().nativeElement;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const label = value.slice(start, end) || 'text';
    const url = 'https://';
    const text = `[${label}](${url})`;
    const urlStart = start + label.length + 3;
    this.replace(start, end, text, urlStart, urlStart + url.length);
  }

  private replace(start: number, end: number, text: string, selStart: number, selEnd: number): void {
    const el = this.area().nativeElement;
    el.focus();
    el.setRangeText(text, start, end, 'end');
    el.setSelectionRange(selStart, selEnd);
    this.onInput();
  }

  protected grow(): void {
    const el = this.area().nativeElement;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden';
  }
}
