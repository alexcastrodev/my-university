import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AwardCard } from '../../components/award-card/award-card';
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
  imports: [AwardCard, RouterLink],
  templateUrl: './public-profile-page.html',
  styleUrl: './public-profile-page.css',
})
export class PublicProfilePage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private seo = inject(SeoService);

  protected state = signal<State>({ kind: 'loading' });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('publicProfileId') ?? '';
    this.seo.set({
      title: 'Learner profile',
      description: 'Badges and trophies earned on My University.',
      path: `/u/${id}`,
      noindex: true,
    });
    this.load(id);
  }

  protected load(id: string = this.route.snapshot.paramMap.get('publicProfileId') ?? ''): void {
    this.state.set({ kind: 'loading' });
    this.http.get<PublicProfile>(`/api/profile/${encodeURIComponent(id)}`).subscribe({
      next: (profile) => this.state.set({ kind: 'ready', profile }),
      error: (error: HttpErrorResponse) => this.state.set({ kind: error.status === 404 ? 'missing' : 'error' }),
    });
  }
}
