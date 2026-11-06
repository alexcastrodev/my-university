import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ProfileBanner } from '../../components/profile-banner/profile-banner';
import { PublicProfile } from '../../models/public-profile.model';
import { SeoService } from '../../services/seo.service';

type State = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error' } | { kind: 'ready'; profile: PublicProfile };

/**
 * A learner's public profile, reached by link. A private profile and an id that never existed look
 * the same here (the API answers 404 for both), so the page cannot reveal that someone exists.
 *
 * It is the shell: the banner, the tabs and the outlet. Overview (awards) and Library (books) are its
 * children and read from it, so switching tabs does not load the profile again.
 */
@Component({
  selector: 'app-public-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProfileBanner, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './public-profile-page.html',
  styleUrl: './public-profile-page.css',
})
export class PublicProfilePage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private seo = inject(SeoService);
  private platformId = inject(PLATFORM_ID);

  /** The profile's slug or its id: the API accepts either. */
  readonly key = this.route.snapshot.paramMap.get('profileKey') ?? '';

  protected state = signal<State>({ kind: 'loading' });
  /** The profile once it has loaded, for the tabs. */
  readonly profile = computed(() => {
    const current = this.state();
    return current.kind === 'ready' ? current.profile : null;
  });

  ngOnInit(): void {
    this.seo.set({
      title: 'Learner profile',
      description: 'Badges and trophies earned on My University.',
      path: `/u/${this.key}`,
      image: `/api/og/profile/${encodeURIComponent(this.key)}`,
      noindex: true,
    });
    // The server renders only the shell and the tags above; the data is fetched in the browser.
    if (isPlatformBrowser(this.platformId)) this.load();
  }

  protected load(): void {
    this.state.set({ kind: 'loading' });
    this.http.get<PublicProfile>(`/api/profile/${encodeURIComponent(this.key)}`).subscribe({
      next: (profile) => this.state.set({ kind: 'ready', profile }),
      error: (error: HttpErrorResponse) => this.state.set({ kind: error.status === 404 ? 'missing' : 'error' }),
    });
  }
}
