import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { JavaConceptView } from '../../components/java-concept-view/java-concept-view';
import { JavaConcept } from '../../models/java-concept.model';
import { JavaConceptsService } from '../../services/java-concepts.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';

@Component({
  selector: 'app-java-concepts-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JavaConceptView, RouterLink],
  templateUrl: './java-concepts-detail.html',
  styleUrl: './java-concepts-detail.css',
})
export class JavaConceptsDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private javaConceptsService = inject(JavaConceptsService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);

  concept = signal<JavaConcept | null>(null);
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
    this.javaConceptsService.getConcept(slug).subscribe({
      next: (concept) => {
        this.concept.set(concept);
        this.read.set(concept.read);
        this.loading.set(false);
        this.seo.set({
          title: `${concept.title} — Java Concepts`,
          description: concept.summary,
          path: `/java/java-concepts/${concept.slug}`,
          type: 'article',
        });
      },
      error: () => { this.loading.set(false); this.notFound.set(true); },
    });
  }

  onMarkRead(): void {
    if (this.read() || this.marking()) return;
    this.marking.set(true);
    this.javaConceptsService.markRead(this.slug).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.xpService.loadSummary();
      },
      error: () => this.marking.set(false),
    });
  }
}
