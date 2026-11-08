import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { DiscussionService } from '../../discussion/discussion.service';
import { AuthService } from '../../services/auth.service';
import { BookmarkService } from '../../services/bookmark.service';
import { LanguageService } from '../../services/language.service';
import { ConceptDiscussion } from '../concept-discussion/concept-discussion';

/**
 * The "Lab" tab of a concept: the call to action, the lab's summary and the students' discussion
 * of the lab (see ConceptDiscussion).
 */
@Component({
  selector: 'app-concept-lab-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptDiscussion],
  templateUrl: './concept-lab-tab.html',
  styleUrl: './concept-lab-tab.css',
})
export class ConceptLabTab {
  labUrl = input.required<string>();
  labHtml = input<SafeHtml | null>(null);
  module = input.required<string>();
  slug = input.required<string>();

  private lang = inject(LanguageService).language;
  private bookmarks = inject(BookmarkService);
  protected auth = inject(AuthService);

  protected readonly finishLockedTitle = $localize`:@@lab.finishLocked:Log in to mark this lab as finished`;

  constructor() {
    const discussion = inject(DiscussionService);
    discussion.labTabOpen.set(true);
    inject(DestroyRef).onDestroy(() => discussion.labTabOpen.set(false));
  }

  protected topic = computed(() => ({ module: this.module(), slug: this.slug(), lang: this.lang }));

  /** The reader said they finished this lab. Separate from "Got it!", which only says they read the concept. */
  protected done = computed(() => this.bookmarks.isLabDone({ module: this.module(), slug: this.slug() }));

  toggleDone(): void {
    if (!this.auth.currentUser()) return;
    this.bookmarks.setLabDone({ module: this.module(), slug: this.slug() }, !this.done());
  }
}
