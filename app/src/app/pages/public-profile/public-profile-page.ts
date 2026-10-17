import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AwardsSections } from '../../components/awards-sections/awards-sections';
import { ProfileBanner } from '../../components/profile-banner/profile-banner';
import { PublicProfile } from '../../models/public-profile.model';
import { SeoService } from '../../services/seo.service';

type State = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error' } | { kind: 'ready'; profile: PublicProfile };

/**
 * A learner's public profile, reached by link. A private profile and an id that never existed look
 * the same here (the API answers 404 for both), so the page cannot reveal that someone exists.
 */
@Component({
  selector: 'app-public-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AwardsSections, ProfileBanner, RouterLink],
  templateUrl: './public-profile-page.html',
  styleUrl: './public-profile-page.css',
})
export class PublicProfilePage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private seo = inject(SeoService);
  private platformId = inject(PLATFORM_ID);

  protected state = signal<State>({ kind: 'loading' });

  ngOnInit(): void {
    const key = this.route.snapshot.paramMap.get('profileKey') ?? '';
    this.seo.set({
      title: 'Learner profile',
      description: 'Badges and trophies earned on My University.',
      path: `/u/${key}`,
      image: `/api/og/profile/${encodeURIComponent(key)}`,
      noindex: true,
    });
    // The server renders only the shell and the tags above; the data is fetched in the browser.
    if (isPlatformBrowser(this.platformId)) this.load(key);
  }

  /** `key` is the profile's slug or its id: the API accepts either. */
  protected load(key: string = this.route.snapshot.paramMap.get('profileKey') ?? ''): void {
    this.state.set({ kind: 'loading' });
    this.http.get<PublicProfile>(`/api/profile/${encodeURIComponent(key)}`).subscribe({
      next: (profile) => this.state.set({ kind: 'ready', profile }),
      error: (error: HttpErrorResponse) => this.state.set({ kind: error.status === 404 ? 'missing' : 'error' }),
    });
  }
}
