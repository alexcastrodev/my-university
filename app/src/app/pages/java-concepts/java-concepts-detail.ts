import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { JavaConceptView } from '../../components/java-concept-view/java-concept-view';
import { JavaConcept } from '../../models/java-concept.model';
import { JavaConceptsService } from '../../services/java-concepts.service';
import { SeoService } from '../../services/seo.service';

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

  concept = signal<JavaConcept | null>(null);
  loading = signal(true);
  notFound = signal(false);

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.javaConceptsService.getConcept(slug).subscribe({
      next: (concept) => {
        this.concept.set(concept);
        this.loading.set(false);
        this.seo.set({
          title: `${concept.title} — Java Concepts`,
          description: concept.summary,
          path: `/java-concepts/${concept.slug}`,
          type: 'article',
        });
      },
      error: () => { this.loading.set(false); this.notFound.set(true); },
    });
  }
}
