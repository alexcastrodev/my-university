import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { renderPostMarkdown } from '../../shared/post-markdown';

export interface MentionSuggestion {
  handle: string;
  name: string;
  avatarUrl: string;
}

/** Grows with its content up to this many px, then scrolls. */
const MAX_HEIGHT_PX = 420;
/** Room the overflow menu needs below its button; with less, it opens upwards. */
const MENU_HEIGHT_PX = 220;
/** Wait this long after the last key before asking the server who matches. */
const MENTION_DEBOUNCE_MS = 200;
/** Same limit the server enforces (`MAX_MENTIONS`); the editor only warns, the server refuses. */
const MAX_MENTIONS = 10;
/** The `@word` right before the caret: what the reader is typing as a mention, a handle or part of a name. */
const TYPING_MENTION = /(?:^|[^\p{L}\p{N}_@./-])@([\p{L}\p{N}-]{1,30})$/u;
/** Mentions already in the text, the same shape the server counts (code is not stripped: a warning can overcount). */
const MENTIONS = /(?<![\p{L}\p{N}_@./-])@([a-z0-9]+(?:-[a-z0-9]+)*)/giu;

let nextId = 0;

/**
 * A small markdown editor for posts: Write and Preview tabs, a toolbar, and a textarea that grows as you type.
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

  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private http = inject(HttpClient);

  /** Ids for the combobox wiring, unique per editor on the page. */
  protected readonly listId = `mention-list-${++nextId}`;
  /** People offered for the `@word` being typed; empty means the list is closed. */
  protected suggestions = signal<MentionSuggestion[]>([]);
  protected activeIndex = signal(0);
  /** Where the `@` of the mention being typed sits, and the query sent for it. */
  private mentionAt = -1;
  private mentionQuery = '';
  private mentionTimer: ReturnType<typeof setTimeout> | undefined;
  protected tooManyMentions = computed(
    () => new Set([...this.value().matchAll(MENTIONS)].map((m) => m[1].toLowerCase())).size > MAX_MENTIONS,
  );

  protected previewing = signal(false);
  protected menuOpen = signal(false);
  protected menuUp = signal(false);
  /** Tells a draft that was just cleared from one that was never typed, so an empty Preview can still say so. */
  private hadContent = false;
  /** Same renderer the published post goes through, so what you preview is what gets shown. */
  protected preview = computed(() => renderPostMarkdown(this.value()));

  constructor() {
    // The parent clears the draft after sending: the box shrinks back and a preview goes back to Write.
    effect(() => {
      if (this.value() !== '') this.hadContent = true;
      else if (this.hadContent) {
        this.hadContent = false;
        this.previewing.set(false);
      }
      queueMicrotask(() => this.grow());
    });
  }

  protected setPreviewing(on: boolean): void {
    this.previewing.set(on);
    this.menuOpen.set(false);
    // A hidden textarea measures 0px, so it has to be resized once it is back.
    if (!on) queueMicrotask(() => this.grow());
  }

  protected onInput(): void {
    this.value.set(this.area().nativeElement.value);
    this.grow();
    this.lookForMention();
  }

  /** Opens (or refreshes) the suggestions when the caret sits right after `@word`, closes them otherwise. */
  protected lookForMention(): void {
    const el = this.area().nativeElement;
    const caret = el.selectionStart;
    const match = el.selectionEnd === caret ? TYPING_MENTION.exec(el.value.slice(0, caret)) : null;
    clearTimeout(this.mentionTimer);
    if (!match) {
      this.closeMentions();
      return;
    }
    const query = match[1];
    this.mentionAt = caret - query.length - 1;
    if (query === this.mentionQuery) return;
    this.mentionQuery = query;
    this.mentionTimer = setTimeout(() => {
      this.http
        .get<MentionSuggestion[]>('/api/discussions/mentions', { params: { q: query } })
        .subscribe({
          next: (people) => {
            // A slow answer for an older query must not replace the list for the newer one.
            if (query !== this.mentionQuery) return;
            this.suggestions.set(people);
            this.activeIndex.set(0);
          },
          error: () => this.suggestions.set([]),
        });
    }, MENTION_DEBOUNCE_MS);
  }

  protected closeMentions(): void {
    clearTimeout(this.mentionTimer);
    this.mentionQuery = '';
    this.mentionAt = -1;
    this.suggestions.set([]);
  }

  /** Replaces the `@word` being typed with the chosen handle and a space, so typing goes on. */
  protected pickMention(person: MentionSuggestion): void {
    const el = this.area().nativeElement;
    const at = this.mentionAt;
    if (at < 0) return;
    this.closeMentions();
    const text = `@${person.handle} `;
    this.replace(at, el.selectionStart, text, at + text.length, at + text.length);
  }

  /** The toolbar button: types an `@` at the caret, which opens the suggestions on the next letter. */
  protected startMention(): void {
    const el = this.area().nativeElement;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const lead = start > 0 && !/\s/.test(value[start - 1]) ? ' ' : '';
    this.replace(start, end, `${lead}@`, start + lead.length + 1, start + lead.length + 1);
  }

  /** Arrows move through the suggestions, Enter or Tab picks, Escape closes. True when the key was used. */
  private mentionKey(event: KeyboardEvent): boolean {
    const people = this.suggestions();
    if (!people.length) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.activeIndex.update((i) => (i + step + people.length) % people.length);
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.metaKey && !event.ctrlKey) {
      this.pickMention(people[this.activeIndex()]);
    } else if (event.key === 'Escape') {
      // Like the menu: Escape closes the list only, not the discussion panel around the editor.
      event.stopPropagation();
      this.closeMentions();
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  }

  protected toggleMenu(button: HTMLElement): void {
    if (!this.menuOpen()) this.menuUp.set(button.getBoundingClientRect().bottom + MENU_HEIGHT_PX > window.innerHeight);
    this.menuOpen.update((open) => !open);
  }

  /** Escape closes the menu only; without stopping it, the discussion panel around the editor would close too. */
  protected closeMenu(event: Event): void {
    if (!this.menuOpen()) return;
    event.stopPropagation();
    this.menuOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.menuOpen() && !this.host.nativeElement.contains(event.target as Node)) this.menuOpen.set(false);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.mentionKey(event)) return;
    if (event.key === 'Escape') {
      this.closeMenu(event);
      return;
    }
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
    // Hidden or not laid out yet (a view coming back, the server render): scrollHeight is 0, and
    // writing it would squash the box to its padding. Leave it on `auto`, which follows `rows`.
    if (!el.scrollHeight) return;
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden';
  }
}
