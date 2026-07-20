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
  templateUrl: './lesson-content.html',
  styleUrl: './lesson-content.css',
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
