import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  SystemDesignConcept,
  SystemDesignConceptLinkRef,
  SystemDesignConceptReference,
} from '../../models/system-design-concept.model';
import { AuthService } from '../../services/auth.service';
import { parseMarkdown } from '../../shared/markdown';

const REFERENCES_TITLE = 'References';

const FEATURE_ROUTES: Record<NonNullable<Extract<SystemDesignConceptLinkRef, object>['feature']>, string> = {
  'system-design': '/system-design/system-design-concepts',
  database: '/databases/database-concepts',
};

export interface ConceptLinkItem {
  label: string;
  route: string[] | null;
}

function toLinkItem(ref: SystemDesignConceptLinkRef): ConceptLinkItem {
  if (typeof ref === 'string') return { label: ref, route: null };
  const base = FEATURE_ROUTES[ref.feature ?? 'system-design'];
  return { label: ref.label, route: [base, ref.slug] };
}

const REFERENCE_TYPE_LABELS: Record<SystemDesignConceptReference['type'], string> = {
  book: 'Books',
  paper: 'Papers',
  engineering: 'Engineering Blogs',
  doc: 'Documentation',
  video: 'Videos',
};

const REFERENCE_TYPE_ICONS: Record<SystemDesignConceptReference['type'], string> = {
  book: '📕',
  paper: '📄',
  engineering: '🏢',
  doc: '📄',
  video: '🎬',
};

@Component({
  selector: 'app-system-design-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './system-design-concept-view.html',
  styleUrl: './system-design-concept-view.css',
})
export class SystemDesignConceptView implements OnChanges {
  concept = input<SystemDesignConcept | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  markRead = output<void>();

  protected auth = inject(AuthService);
  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);
  referenceGroups = signal<{ type: SystemDesignConceptReference['type']; label: string; icon: string; refs: SystemDesignConceptReference[] }[]>([]);
  prerequisiteItems = signal<ConceptLinkItem[]>([]);
  relatedItems = signal<ConceptLinkItem[]>([]);

  onMarkRead(): void {
    if (!this.auth.currentUser() || this.read() || this.marking()) return;
    this.markRead.emit();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['concept']) return;

    const concept = this.concept();
    if (!concept) {
      this.sections.set([]);
      this.referenceGroups.set([]);
      this.prerequisiteItems.set([]);
      this.relatedItems.set([]);
      return;
    }

    this.sections.set(
      concept.sections
        .filter((section) => section.title !== REFERENCES_TITLE)
        .map((section) => ({ title: section.title, html: parseMarkdown(this.sanitizer, section.content) })),
    );

    const grouped = new Map<SystemDesignConceptReference['type'], SystemDesignConceptReference[]>();
    for (const ref of concept.references) {
      const group = grouped.get(ref.type) ?? [];
      group.push(ref);
      grouped.set(ref.type, group);
    }
    this.referenceGroups.set(
      Array.from(grouped.entries()).map(([type, refs]) => ({
        type,
        label: REFERENCE_TYPE_LABELS[type],
        icon: REFERENCE_TYPE_ICONS[type],
        refs,
      })),
    );

    this.prerequisiteItems.set(concept.prerequisites.map(toLinkItem));
    this.relatedItems.set(concept.related.map(toLinkItem));
  }
}
