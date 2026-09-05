import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CURRICULUM } from '../computer-science/curriculum.data';
import { CurriculumConceptSummary } from '../../models/curriculum-concept.model';
import { CurriculumConceptsService } from '../../services/curriculum-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

@Component({
  selector: 'app-curriculum-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './curriculum-concepts-list.html',
  styleUrl: './curriculum-concepts-list.css',
})
export class CurriculumConceptsListPage implements OnInit {
  private route = inject(ActivatedRoute);
  private curriculumConceptsService = inject(CurriculumConceptsService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;

  private mod = signal('');
  private discipline = signal('');
  protected readonly routeCommands = computed(() => ['/computer-science', this.mod(), this.discipline()]);

  concepts = signal<CurriculumConceptSummary[]>([]);
  loading = signal(true);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => sortByRead(this.concepts(), this.readSort()));

  protected readonly disciplineTitle = computed(() => {
    const mod = CURRICULUM.find((m) => m.slug === this.mod());
    const disc =
      mod?.disciplines?.find((d) => d.slug === this.discipline()) ??
      mod?.tracks?.find((t) => t.slug === this.discipline());
    return disc?.title ?? this.discipline();
  });

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const mod = params.get('module') ?? '';
      const discipline = params.get('discipline') ?? '';
      this.mod.set(mod);
      this.discipline.set(discipline);

      this.seo.set({
        title: this.disciplineTitle(),
        description: `${this.disciplineTitle()} — part of the Computer Science curriculum.`,
        path: `/computer-science/${mod}/${discipline}`,
      });

      this.loading.set(true);
      this.curriculumConceptsService.listConcepts(mod, discipline).subscribe({
        next: (list) => {
          this.concepts.set(list);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
    });
  }
}
