import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';

/**
 * What the Kurz does with a student's data. The version is what a student confirms on their first question
 * (`KURZ_TERMS_VERSION` in backend/src/kurz/kurz.config.ts): change a rule on this page and raise both, and
 * everyone confirms again.
 */
export const PRIVACY_NOTICE_VERSION = '1';

@Component({
  selector: 'app-privacy-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './privacy-page.html',
  styleUrl: './privacy-page.css',
})
export class PrivacyPage implements OnInit {
  private seo = inject(SeoService);
  protected readonly version = PRIVACY_NOTICE_VERSION;

  ngOnInit(): void {
    this.seo.set({
      title: 'Privacy',
      description:
        'What the Kurz, the assistant of the posts, does with your questions and who sees them.',
      path: '/privacy',
    });
  }
}
