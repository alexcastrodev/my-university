import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';

/**
 * Hub behind the phone bar's Study tab: one card per place to study. The desktop sidebar lists
 * these destinations directly, so nothing links here on desktop and the page stays out of search.
 */
@Component({
  selector: 'app-studies-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './studies-page.html',
  styleUrl: './studies-page.css',
})
export class StudiesPage implements OnInit {
  private seo = inject(SeoService);

  ngOnInit() {
    this.seo.set({
      title: $localize`:@@studies.seo.title:Study`,
      description: $localize`:@@studies.seo.description:Tracks, certifications, papers and the Computer Science curriculum in one place.`,
      path: '/studies',
      noindex: true,
    });
  }
}
