import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatabaseConceptCategory, DatabaseConceptSummary } from '../../models/database-concept.model';
import { DatabaseConceptsService } from '../../services/database-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';
import { TranslationKey } from '../../shared/i18n/translations';

const CATEGORY_OPTIONS: { label: TranslationKey; value: DatabaseConceptCategory | null }[] = [
  { label: 'concepts.filters.all', value: null },
  { label: 'databaseConcepts.category.postgresql', value: 'PostgreSQL' },
  { label: 'databaseConcepts.category.sql', value: 'SQL' },
  { label: 'databaseConcepts.category.mongodb', value: 'MongoDB' },
  { label: 'databaseConcepts.category.dynamodb', value: 'DynamoDB' },
  { label: 'databaseConcepts.category.cassandra', value: 'Cassandra' },
  { label: 'databaseConcepts.category.redis', value: 'Redis' },
  { label: 'databaseConcepts.category.neo4j', value: 'Neo4j' },
  { label: 'databaseConcepts.category.hbase', value: 'HBase' },
  { label: 'databaseConcepts.category.couchdb', value: 'CouchDB' },
];

export interface DatabaseConceptTopicGroup {
  topic: string;
  concepts: DatabaseConceptSummary[];
}

/** Everyday SQL querying first, then advanced patterns, then MongoDB's document model
 *  and indexing, then DynamoDB's modeling approach, then Cassandra's distributed core,
 *  then Redis's data types/patterns, then Neo4j/HBase/CouchDB's own models, then
 *  Postgres ops/infra. */
const TOPIC_ORDER = [
  'Query Techniques',
  'Joins & Set Operations',
  'Window Functions & Analytics',
  'Date & Time',
  'String & Text Processing',
  'Advanced Query Patterns',
  'Document Model',
  'Indexing & Performance',
  'Graph Fundamentals',
  'Wide-Column Fundamentals',
  'Transactions & Consistency',
  'High Availability',
  'Scaling & Sharding',
  'Fundamentals',
  'Data Modeling',
  'Key Design & Partitioning',
  'Relationship Strategies',
  'Advanced Mechanics',
  'API & Access Patterns',
  'Evolution & Migration',
  'Consistency & Replication',
  'Indexing & Extending Designs',
  'Data Types & Commands',
  'Application Patterns',
  'Coordination Primitives',
  'Durability & Persistence',
  'Security',
  'Modern Redis Capabilities',
  'Scaling & Topology',
  'Configuration & Tuning',
  'Monitoring & Troubleshooting',
  'HA & Replication',
];

@Component({
  selector: 'app-database-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './database-concepts-list.html',
  styleUrl: './database-concepts-list.css',
})
export class DatabaseConceptsListPage implements OnInit {
  private databaseConceptsService = inject(DatabaseConceptsService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/databases/database-concepts'];

  concepts = signal<DatabaseConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<DatabaseConceptCategory | null>(null);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const category = this.selectedCategory();
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();

    const filtered = all.filter((c) => {
      const matchesCategory = !category || c.category === category;
      const matchesLab = !showLabs || c.labUrl;
      return matchesCategory && matchesLab;
    });

    return sortByRead(filtered, this.readSort());
  });

  groupedConcepts = computed<DatabaseConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, DatabaseConceptSummary[]>();
    for (const concept of this.filteredConcepts()) {
      const group = byTopic.get(concept.topic);
      if (group) group.push(concept);
      else byTopic.set(concept.topic, [concept]);
    }

    const known = TOPIC_ORDER.filter((topic) => byTopic.has(topic));
    const unknown = [...byTopic.keys()].filter((topic) => !TOPIC_ORDER.includes(topic)).sort();
    return [...known, ...unknown].map((topic) => ({ topic, concepts: byTopic.get(topic)! }));
  });

  onFilterChange(category: DatabaseConceptCategory | null) {
    this.selectedCategory.set(category);
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  ngOnInit() {
    this.seo.set({
      title: 'Database Concepts',
      description: 'PostgreSQL, SQL, MongoDB, and DynamoDB concepts explained in depth — objective, use cases, deep dive, and trade-offs.',
      path: '/databases/database-concepts',
    });

    this.databaseConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
