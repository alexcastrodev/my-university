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
import { parseMarkdown } from '../../shared/markdown';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';

@Component({
  selector: 'app-lesson-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective],
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
    void this.router.navigate(['/java/exam', examId, 'lesson', lessonId]);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['lessonContent']) {
      const lc = this.lessonContent();
      if (lc) {
        this.html.set(parseMarkdown(this.sanitizer, lc.content).html);
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
