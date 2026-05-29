import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnChanges,
  SimpleChanges,
  inject,
  input,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

const wikiLinkExtension = {
  name: 'wikiLink',
  level: 'inline' as const,
  start(src: string) { return src.indexOf('[['); },
  tokenizer(src: string) {
    const match = /^\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/.exec(src);
    if (!match) return undefined;
    const slug = match[1].trim();
    const label = (match[2] ?? slug).trim();
    return { type: 'wikiLink', raw: match[0], slug, label } as any;
  },
  renderer(token: any) {
    const m = /^(\d+)-(\d+)(?:-|$)/.exec(token.slug);
    const lessonId = m ? `j25-${m[1]}-${m[2]}` : token.slug;
    return `<a class="wiki-link" data-lesson-id="${lessonId}" href="#lesson/${lessonId}">${token.label}</a>`;
  },
};
marked.use({ extensions: [wikiLinkExtension] });

@Component({
  selector: 'app-lesson-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (html()) {
      <article class="lesson-body" [innerHTML]="html()"></article>
      @if (version() || updatedAt()) {
        <footer class="lesson-meta">
          @if (version()) { <span>v{{ version() }}</span> }
          @if (version() && updatedAt()) { <span class="sep">·</span> }
          @if (updatedAt()) { <span>Last updated {{ updatedAt() }}</span> }
        </footer>
      }
    } @else {
      <div class="lesson-empty">
        <p>No content available for this lesson.</p>
      </div>
    }
  `,
  styles: `
    .lesson-body {
      padding: 2rem 2.5rem;
      max-width: 820px;
      font-size: 0.9rem;
      line-height: 1.75;
      color: #1f2937;
    }

    .lesson-body :global(h1) {
      font-size: 1.5rem;
      font-weight: 700;
      color: #111827;
      margin: 0 0 1.5rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #f3f4f6;
    }

    .lesson-body :global(h2) {
      font-size: 1.1rem;
      font-weight: 700;
      color: #111827;
      margin: 2rem 0 0.75rem;
    }

    .lesson-body :global(h3) {
      font-size: 0.95rem;
      font-weight: 600;
      color: #374151;
      margin: 1.5rem 0 0.5rem;
    }

    .lesson-body :global(p) {
      margin: 0 0 1rem;
    }

    .lesson-body :global(pre) {
      background: #1e293b;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      overflow-x: auto;
      font-size: 0.82rem;
      margin: 1rem 0 1.25rem;
      line-height: 1.6;
    }

    .lesson-body :global(code) {
      font-family: 'Fira Code', 'Cascadia Code', 'Menlo', monospace;
    }

    .lesson-body :global(p code),
    .lesson-body :global(li code) {
      background: #f1f5f9;
      color: #c74634;
      border-radius: 4px;
      padding: 0.1em 0.35em;
      font-size: 0.85em;
    }

    .lesson-body :global(table) {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0 1.5rem;
      font-size: 0.83rem;
    }

    .lesson-body :global(th) {
      background: #f9fafb;
      font-weight: 600;
      text-align: left;
      padding: 0.5rem 0.75rem;
      border: 1px solid #e5e7eb;
      color: #374151;
    }

    .lesson-body :global(td) {
      padding: 0.45rem 0.75rem;
      border: 1px solid #e5e7eb;
      vertical-align: top;
    }

    .lesson-body :global(tr:nth-child(even) td) {
      background: #f9fafb;
    }

    .lesson-body :global(ul),
    .lesson-body :global(ol) {
      margin: 0 0 1rem 1.25rem;
      padding: 0;
    }

    .lesson-body :global(li) {
      margin-bottom: 0.3rem;
    }

    .lesson-body :global(blockquote) {
      border-left: 4px solid #c74634;
      background: #fff7f6;
      margin: 1rem 0;
      padding: 0.75rem 1rem;
      border-radius: 0 6px 6px 0;
      color: #374151;
    }

    .lesson-body :global(blockquote p) {
      margin: 0;
    }

    .lesson-body :global(hr) {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 2rem 0;
    }

    .lesson-body :global(strong) {
      color: #111827;
    }

    .lesson-body :global(a.wiki-link) {
      color: #c74634;
      text-decoration: none;
      border-bottom: 1px dashed #c74634;
      cursor: pointer;
    }

    .lesson-body :global(a.wiki-link:hover) {
      border-bottom-style: solid;
    }

    .lesson-meta {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.75rem 2.5rem 1.5rem;
      font-size: 0.75rem;
      color: #9ca3af;
    }

    .lesson-meta .sep {
      color: #d1d5db;
    }

    .lesson-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 40vh;
      color: #9ca3af;
      font-size: 0.875rem;
    }
  `,
})
export class LessonContent implements OnChanges {
  lessonContent = input<{ content: string; version: string | null; updatedAt: string | null } | null>(null);

  private sanitizer = inject(DomSanitizer);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  html = signal<SafeHtml | null>(null);
  version = signal<string | null>(null);
  updatedAt = signal<string | null>(null);

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const link = target?.closest('a.wiki-link') as HTMLAnchorElement | null;
    if (!link) return;
    const lessonId = link.dataset['lessonId'];
    if (!lessonId) return;
    event.preventDefault();
    const examId = this.route.snapshot.paramMap.get('examId')
      ?? this.route.snapshot.root.firstChild?.paramMap.get('examId')
      ?? 'java-25';
    void this.router.navigate(['/exam', examId, 'lesson', lessonId]);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['lessonContent']) {
      const lc = this.lessonContent();
      if (lc) {
        const rawHtml = marked.parse(lc.content) as string;
        this.html.set(this.sanitizer.bypassSecurityTrustHtml(rawHtml));
        this.version.set(lc.version);
        this.updatedAt.set(lc.updatedAt);
      } else {
        this.html.set(null);
        this.version.set(null);
        this.updatedAt.set(null);
      }
    }
  }
}
