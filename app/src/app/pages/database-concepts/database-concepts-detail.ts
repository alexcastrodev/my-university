import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatabaseConceptView } from '../../components/database-concept-view/database-concept-view';
import { DatabaseConcept } from '../../models/database-concept.model';
import { DatabaseConceptsService } from '../../services/database-concepts.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';

@Component({
  selector: 'app-database-concepts-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatabaseConceptView, RouterLink],
  templateUrl: './database-concepts-detail.html',
  styleUrl: './database-concepts-detail.css',
})
export class DatabaseConceptsDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private databaseConceptsService = inject(DatabaseConceptsService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);

  concept = signal<DatabaseConcept | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);

  private slug = '';

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      this.loadConcept(params.get('slug') ?? '');
    });
  }

  private loadConcept(slug: string): void {
    this.slug = slug;
    this.loading.set(true);
    this.notFound.set(false);
    this.marking.set(false);
    this.concept.set(null);
    this.databaseConceptsService.getConcept(slug).subscribe({
      next: (concept) => {
        this.concept.set(concept);
        this.read.set(concept.read);
        this.loading.set(false);
        this.seo.set({
          title: `${concept.title} — Database Concepts`,
          description: concept.summary,
          path: `/databases/database-concepts/${concept.slug}`,
          type: 'article',
        });
      },
      error: () => { this.loading.set(false); this.notFound.set(true); },
    });
  }

  onMarkRead(): void {
    if (this.read() || this.marking()) return;
    this.marking.set(true);
    this.databaseConceptsService.markRead(this.slug).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.xpService.loadSummary();
      },
      error: () => this.marking.set(false),
    });
  }
}
